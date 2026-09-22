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

let client: OpenAI | null = null;

function getClient(): OpenAI {
  if (!client) {
    const cfg = getServerConfig();
    client = new OpenAI({
      apiKey: cfg.OPENAI_API_KEY,
      ...(cfg.OPENAI_BASE_URL ? { baseURL: cfg.OPENAI_BASE_URL } : {}),
    });
  }
  return client;
}

function jitter(ms: number): number {
  // ±25%
  return Math.round(ms * (0.75 + Math.random() * 0.5));
}

function isRetryable(err: unknown): boolean {
  if (err instanceof OpenAI.APIError) {
    // A 400-class error is not retried — retrying cannot fix a bad request.
    return err.status === 429 || (err.status !== undefined && err.status >= 500);
  }
  // Timeouts and network errors.
  return true;
}

function isTimeout(err: unknown): boolean {
  if (err instanceof OpenAI.APIConnectionTimeoutError) return true;
  // Our own per-attempt timer aborts the request; the SDK surfaces that as
  // APIUserAbortError, which is a timeout for our purposes, not a provider error.
  if (err instanceof OpenAI.APIUserAbortError) return true;
  return err instanceof Error && err.name === 'AbortError';
}

export async function callLlm(opts: LlmCallOptions): Promise<LlmResult> {
  const cfg = getServerConfig();
  const perAttemptTimeout = opts.timeoutMs ?? cfg.OPENAI_TIMEOUT_MS;
  const maxAttempts = opts.maxAttempts ?? cfg.OPENAI_MAX_RETRIES;
  const model = modelFor(opts.purpose);
  if (!model) throw new Error(`No model configured for purpose ${opts.purpose}`);

  let lastError: unknown = null;
  let lastWasTimeout = false;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    // Deadline arithmetic: never start an attempt that cannot finish.
    let timeoutForAttempt = perAttemptTimeout;
    if (opts.deadlineAt !== undefined) {
      const remaining = opts.deadlineAt - Date.now();
      if (remaining < MIN_ATTEMPT_BUDGET_MS) break;
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

      // Every attempt writes a row, including failures.
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

      const backoff = jitter(BACKOFF_BASE_MS[attempt - 1] ?? 4_000);
      if (opts.deadlineAt !== undefined && Date.now() + backoff >= opts.deadlineAt) break;
      await new Promise((resolve) => setTimeout(resolve, backoff));
    } finally {
      clearTimeout(timer);
    }
  }

  if (lastWasTimeout) throw appError('AI_TIMEOUT');
  if (lastError instanceof OpenAI.APIError && lastError.status === 429) {
    throw appError('AI_UNAVAILABLE');
  }
  throw appError('AI_UNAVAILABLE');
}
