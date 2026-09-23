import 'server-only';
import OpenAI from 'openai';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getServerConfig } from '@/lib/utils/server-config';
import { appError } from '@/lib/errors/app-error';
import { recordOpenAiCall } from '@/lib/metrics/cost';

/**
 * The only place the OpenAI API key is used (spec 06 §1).
 *
 * Provider neutrality: this module is the `LlmProvider` boundary — model id and
 * pricing live in config, so a future Claude/Gemini adapter is a config plus
 * adapter change. **No fallback provider is wired at MVP — do not add one.**
 */

export type LlmPurpose = 'extraction' | 'chat' | 'repair' | 'summary' | 'query_enhancer' | 'judge';

/**
 * Model id per purpose (spec 06 v1.1 §A, spec 01 v1.1 §B). Each falls back to
 * OPENAI_MODEL when unset; the judge has no product fallback and returns null
 * when unset so its runners emit SKIPPED (spec 22 §6.1).
 */
export function modelFor(purpose: LlmPurpose): string | null {
  const cfg = getServerConfig();
  const pick = (v: string | undefined) => (v && v.length > 0 ? v : cfg.OPENAI_MODEL);
  switch (purpose) {
    case 'extraction':
    case 'repair':
      return pick(cfg.OPENAI_MODEL_EXTRACTION);
    case 'chat':
      return pick(cfg.OPENAI_MODEL_CHAT);
    case 'summary':
      return pick(cfg.OPENAI_MODEL_SUMMARY);
    case 'query_enhancer':
      return pick(cfg.OPENAI_MODEL_ENHANCER);
    case 'judge':
      return cfg.OPENAI_MODEL_JUDGE && cfg.OPENAI_MODEL_JUDGE.length > 0 ? cfg.OPENAI_MODEL_JUDGE : null;
  }
}

export interface LlmMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LlmCallOptions {
  purpose: LlmPurpose;
  messages: LlmMessage[];
  jsonMode?: boolean;
  temperature: number;
  maxTokens: number;
  /** Sent as OpenAI `user` for abuse tracing (PRD §5 GDPR line). */
  userId: string;
  contractId?: string | null;
  timeoutMs?: number;
  /** Epoch ms. No attempt is started that cannot finish before this. */
  deadlineAt?: number;
  /** Overrides OPENAI_MAX_RETRIES (the summary is a single attempt, spec 06 v1.1 §B). */
  maxAttempts?: number;
  supabase: SupabaseClient;
}

export interface LlmResult {
  content: string;
  promptTokens: number;
  completionTokens: number;
  latencyMs: number;
  attempts: number;
}

/** An attempt is only started if at least this much budget remains. */
const MIN_ATTEMPT_BUDGET_MS = 6_000;
const BACKOFF_BASE_MS = [1_000, 2_000, 4_000];
/**
 * L6: however long the provider says to wait after a 429, we never sit on it
 * for more than this. A `6m0s` token reset would otherwise burn a whole job
 * budget doing nothing.
 */
const RATE_LIMIT_MAX_WAIT_MS = 30_000;

/**
 * Parses an OpenAI rate-limit duration header — `"6m0s"`, `"1.2s"`, `"20ms"`,
 * `"1h2m3s"` — into milliseconds (L6, spec 06 v1.1 §3).
 *
 * Returns `null` for an absent, empty or unparseable value, including a bare
 * number with no unit, so the caller can fall back to its own schedule rather
 * than act on a misread header. `ms` is matched before `m` so `"20ms"` is
 * twenty milliseconds, not twenty minutes.
 */
export function parseRateLimitDuration(raw: string | null | undefined): number | null {
  if (typeof raw !== 'string') return null;
  const text = raw.trim();
  if (text.length === 0) return null;

  const unitMs: Record<string, number> = { h: 3_600_000, m: 60_000, s: 1_000, ms: 1 };
  const token = /(\d+(?:\.\d+)?)(ms|h|m|s)/g;

  let total = 0;
  let consumed = 0;
  let match: RegExpExecArray | null;
  while ((match = token.exec(text)) !== null) {
    // Anything between tokens means this is not a duration string at all.
    if (match.index !== consumed) return null;
    total += Number(match[1]) * unitMs[match[2]!]!;
    consumed = match.index + match[0].length;
  }
  if (consumed !== text.length) return null;
  return Math.round(total);
}

let client: OpenAI | null = null;

function getClient(): OpenAI {
  if (!client) {
    const cfg = getServerConfig();
    client = new OpenAI({
      apiKey: cfg.OPENAI_API_KEY,
      // L5: the SDK retries twice by default. That layer is invisible to us —
      // it writes no `openai_calls` row and multiplies the per-attempt timeout
      // behind the deadline arithmetic below. `callLlm`'s loop is the only
      // retry layer, so every attempt is recorded and budgeted.
      maxRetries: 0,
      ...(cfg.OPENAI_BASE_URL ? { baseURL: cfg.OPENAI_BASE_URL } : {}),
    });
  }
  return client;
}

function jitterPct(ms: number, pct: number): number {
  return Math.round(ms * (1 - pct + Math.random() * pct * 2));
}

function jitter(ms: number): number {
  // ±25%
  return jitterPct(ms, 0.25);
}

/** The class name; the SDK sets no `.name`, so every error reads as 'Error'. */
function errorName(err: unknown): string {
  if (err instanceof Error) return err.constructor?.name ?? err.name;
  return typeof err;
}

/**
 * The wait a 429 asks for, in ms, or `null` when it names none (L6).
 * Header precedence: `retry-after-ms`, then `retry-after` (seconds), then the
 * larger of the two reset clocks — a token reset and a request reset can
 * disagree, and the longer one is the one that actually gates us.
 */
function rateLimitWaitMs(err: unknown): number | null {
  if (!(err instanceof OpenAI.APIError) || err.status !== 429) return null;
  const headers = err.headers;
  const header = (name: string): string | null => headers?.get(name) ?? null;

  const msRaw = header('retry-after-ms');
  if (msRaw !== null) {
    const ms = Number(msRaw);
    if (Number.isFinite(ms) && ms >= 0) return Math.round(ms);
  }

  const secRaw = header('retry-after');
  if (secRaw !== null) {
    const sec = Number(secRaw);
    if (Number.isFinite(sec) && sec >= 0) return Math.round(sec * 1_000);
  }

  const tokens = parseRateLimitDuration(header('x-ratelimit-reset-tokens'));
  const requests = parseRateLimitDuration(header('x-ratelimit-reset-requests'));
  if (tokens !== null || requests !== null) return Math.max(tokens ?? 0, requests ?? 0);

  return null;
}

/** A 429 for `insufficient_quota` is billing, not rate — retrying cannot help. */
function isInsufficientQuota(err: unknown): boolean {
  return err instanceof OpenAI.APIError && err.status === 429 && err.code === 'insufficient_quota';
}

function isTimeout(err: unknown): boolean {
  if (err instanceof OpenAI.APIConnectionTimeoutError) return true;
  // Our own per-attempt timer aborts the request; the SDK surfaces that as
  // APIUserAbortError, which is a timeout for our purposes, not a provider error.
  if (err instanceof OpenAI.APIUserAbortError) return true;
  return err instanceof Error && err.name === 'AbortError';
}

function isRetryable(err: unknown): boolean {
  // L5 (spec 06 v1.1 §3): timeouts and connection failures FIRST. The SDK
  // models APIUserAbortError, APIConnectionError and APIConnectionTimeoutError
  // as APIError subclasses whose `status` is `undefined`, so the status check
  // below classifies all three as non-retryable if it is reached first — which
  // is why a single slow extraction batch killed a 120 s background job.
  if (isTimeout(err)) return true;
  if (err instanceof OpenAI.APIConnectionError) return true;
  if (err instanceof OpenAI.APIError) {
    // L6: a rate limit is retryable, but a quota exhaustion at the same status
    // is a billing state — retrying it only burns the remaining budget.
    if (err.status === 429) return !isInsufficientQuota(err);
    // A 400-class error is not retried — retrying cannot fix a bad request.
    return err.status !== undefined && err.status >= 500;
  }
  // Anything else (a network error the SDK did not wrap) is worth one more go.
  return true;
}

export async function callLlm(opts: LlmCallOptions): Promise<LlmResult> {
  const cfg = getServerConfig();
  const perAttemptTimeout = opts.timeoutMs ?? cfg.OPENAI_TIMEOUT_MS;
  const maxAttempts = opts.maxAttempts ?? cfg.OPENAI_MAX_RETRIES;
  const model = modelFor(opts.purpose);
  if (!model) throw new Error(`No model configured for purpose ${opts.purpose}`);

  let lastError: unknown = null;
  let lastWasTimeout = false;
  let outOfBudget = false;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    // Deadline arithmetic: never start an attempt that cannot finish.
    let timeoutForAttempt = perAttemptTimeout;
    if (opts.deadlineAt !== undefined) {
      const remaining = opts.deadlineAt - Date.now();
      if (remaining < MIN_ATTEMPT_BUDGET_MS) {
        outOfBudget = true;
        break;
      }
      timeoutForAttempt = Math.min(perAttemptTimeout, remaining - 1_000);
    }

    const startedAt = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutForAttempt);

    try {
      const response = await getClient().chat.completions.create(
        {
          model,
          messages: opts.messages,
          temperature: opts.temperature,
          max_tokens: opts.maxTokens,
          user: opts.userId,
          ...(opts.jsonMode ? { response_format: { type: 'json_object' as const } } : {}),
        },
        { signal: controller.signal, timeout: timeoutForAttempt },
      );

      const latencyMs = Date.now() - startedAt;
      const promptTokens = response.usage?.prompt_tokens ?? 0;
      const completionTokens = response.usage?.completion_tokens ?? 0;

      await recordOpenAiCall(opts.supabase, {
        userId: opts.userId,
        contractId: opts.contractId,
        purpose: opts.purpose,
        model,
        promptTokens,
        completionTokens,
        latencyMs,
        attempt,
        outcome: 'success',
      });

      return {
        content: response.choices[0]?.message?.content ?? '',
        promptTokens,
        completionTokens,
        latencyMs,
        attempts: attempt,
      };
    } catch (err) {
      const latencyMs = Date.now() - startedAt;
      lastError = err;
      lastWasTimeout = isTimeout(err);
      const retryAfterMs = rateLimitWaitMs(err);

      // L6 (spec 06 v1.1 §3): one line per failed attempt. `openai_calls`
      // records that an attempt failed; this records WHICH failure it was —
      // the gap that left contract 93ba9b49's 379 ms summary repair
      // unclassified. Identifiers and classifications only: no key material,
      // no prompt text, no response body.
      console.warn(
        JSON.stringify({
          llm: 'attempt_failed',
          purpose: opts.purpose,
          attempt,
          name: errorName(err),
          status: err instanceof OpenAI.APIError ? err.status ?? null : null,
          code: err instanceof OpenAI.APIError ? err.code ?? null : null,
          retryAfterMs,
          latencyMs,
        }),
      );

      // Every attempt writes a row, including failures. A 429 is recorded as
      // 'error': the `openai_calls.outcome` CHECK allows only
      // ('success','timeout','error','invalid_json') and the schema is
      // deliberately not changed here (L6) — the log line above carries the
      // rate-limit distinction.
      await recordOpenAiCall(opts.supabase, {
        userId: opts.userId,
        contractId: opts.contractId,
        purpose: opts.purpose,
        model,
        promptTokens: 0,
        completionTokens: 0,
        latencyMs,
        attempt,
        outcome: lastWasTimeout ? 'timeout' : 'error',
      });

      if (!isRetryable(err) || attempt === maxAttempts) break;

      // L6: a 429 is retried on the provider's clock, jittered ±10% so a
      // batch's parallel calls do not return in lockstep, and capped. Anything
      // else keeps the 1/2/4 s schedule.
      const backoff =
        retryAfterMs !== null
          ? Math.min(jitterPct(retryAfterMs, 0.1), RATE_LIMIT_MAX_WAIT_MS)
          : jitter(BACKOFF_BASE_MS[attempt - 1] ?? 4_000);

      // Only wait if a full attempt still fits afterwards; waiting into a
      // budget too small to use just delays the same failure.
      if (opts.deadlineAt !== undefined && Date.now() + backoff + MIN_ATTEMPT_BUDGET_MS > opts.deadlineAt) break;
      await new Promise((resolve) => setTimeout(resolve, backoff));
    } finally {
      clearTimeout(timer);
    }
  }

  // G43: a deadline that leaves no room for even a first attempt is a timeout
  // of the caller's budget, not an unavailable provider — the chat turn's 15 s
  // budget runs out as 504 AI_TIMEOUT, as spec 08 §3 says.
  if (lastWasTimeout || (outOfBudget && lastError === null)) throw appError('AI_TIMEOUT');
  if (isInsufficientQuota(lastError)) {
    // Ops-actionable and not self-healing: no amount of retrying or waiting
    // clears it, so it is called out separately from an ordinary rate limit.
    console.error(JSON.stringify({ llm: 'insufficient_quota', purpose: opts.purpose, model }));
  }
  throw appError('AI_UNAVAILABLE');
}
