import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { callLlm } from '@/lib/ai/openai-client';
import {
  SUMMARY_REPAIR_PROMPT,
  SUMMARY_SYSTEM_PROMPT,
  buildSummaryUserMessage,
} from '@/lib/ai/prompts/summary.v1';
import {
  enforceWordBudget,
  normaliseMarkdown,
  uncitedFactualSentences,
} from '@/lib/ai/summary-validation';
import { getServerConfig } from '@/lib/utils/server-config';
import { recordProcessingRun } from '@/lib/metrics/timings';
import { recordEvent } from '@/lib/metrics/events';
import { AppError } from '@/lib/errors/app-error';
import type { PersistableTerm } from './extraction-service';

/**
 * Contract summary (spec 06 v1.1 §B, US-015; D45 2026-09-21: full contract text).
 *
 * Claim first, always. The inline path (step 11a) claims `pending`; route 34
 * claims `pending | error | none` or a `processing` claim older than 2 min.
 * Exactly one call per claim, whichever path wins.
 */

export const SUMMARY_STALE_CLAIM_MS = 2 * 60 * 1000;
/** Step 11a runs only if at least this much of the handler budget remains. */
export const SUMMARY_MIN_REMAINING_MS = 11_000;
/** D45: per-summary allowance at GPT-4o pricing (reported, not enforced pre-call). */
export const SUMMARY_ALLOWANCE_USD = 0.05;

export type SummaryTerm = Pick<PersistableTerm, 'term_name' | 'value' | 'page_number' | 'source_sentence'>;

export interface SummaryContract {
  id: string;
  user_id: string;
  contract_text: string;
  page_count: number;
}

/** Inline claim: only a `pending` row is claimed. Returns true when this caller won. */
export async function claimSummaryInline(supabase: SupabaseClient, contractId: string, userId: string): Promise<boolean> {
  const { data } = await supabase
    .from('contracts')
    .update({ summary_status: 'processing', summary_claimed_at: new Date().toISOString() })
    .eq('id', contractId)
    .eq('user_id', userId)
    .eq('summary_status', 'pending')
    .select('id');
  return (data?.length ?? 0) === 1;
}

/** Route 34 claim: pending | error | none, or a stale `processing` claim. */
export async function claimSummaryDeferred(supabase: SupabaseClient, contractId: string, userId: string): Promise<boolean> {
  const staleBefore = new Date(Date.now() - SUMMARY_STALE_CLAIM_MS).toISOString();
  const { data } = await supabase
    .from('contracts')
    .update({ summary_status: 'processing', summary_claimed_at: new Date().toISOString() })
    .eq('id', contractId)
    .eq('user_id', userId)
    .eq('status', 'completed')
    .or(`summary_status.in.(pending,error,none),and(summary_status.eq.processing,summary_claimed_at.lt.${staleBefore})`)
    .select('id');
  return (data?.length ?? 0) === 1;
}

export interface SummaryResult {
  summary_md: string | null;
  summary_status: 'completed' | 'error';
  summary_uncited: boolean;
  summary_generated_ms: number;
  error_code?: string;
}

/**
 * Runs the §B call for a contract the caller has already claimed, validates,
 * repairs once if needed, and persists. Never throws: a failure is persisted as
 * `summary_status='error'` and returned.
 */
export async function runSummary(
  supabase: SupabaseClient,
  contract: SummaryContract,
  terms: SummaryTerm[],
  opts: { deadlineAt?: number } = {},
): Promise<SummaryResult> {
  const cfg = getServerConfig();
  const startedAt = Date.now();
  const facts = terms
    .map((t) => t.value)
    .filter((v): v is string => typeof v === 'string' && v.trim().length >= 4);
  const ctx = { pageCount: contract.page_count, facts };
  const messages = [
    { role: 'system' as const, content: SUMMARY_SYSTEM_PROMPT },
    { role: 'user' as const, content: buildSummaryUserMessage(contract.contract_text, terms) },
  ];
  const call = { purpose: 'summary' as const, temperature: cfg.OPENAI_SUMMARY_TEMPERATURE, maxTokens: cfg.OPENAI_SUMMARY_MAX_TOKENS, timeoutMs: cfg.OPENAI_SUMMARY_TIMEOUT_MS, maxAttempts: 1, userId: contract.user_id, contractId: contract.id, deadlineAt: opts.deadlineAt, supabase };

  try {
    const first = await callLlm({ ...call, messages });
    let md = enforceWordBudget(normaliseMarkdown(first.content));
    let uncited = uncitedFactualSentences(md, ctx);

    if (uncited.length > 0 && (opts.deadlineAt === undefined || opts.deadlineAt - Date.now() > 6_000)) {
      // One repair call, within the remaining budget.
      const repaired = await callLlm({
        ...call,
        messages: [...messages, { role: 'assistant', content: md }, { role: 'user', content: SUMMARY_REPAIR_PROMPT }],
      });
      const repairedMd = enforceWordBudget(normaliseMarkdown(repaired.content));
      const repairedUncited = uncitedFactualSentences(repairedMd, ctx);
      if (repairedUncited.length < uncited.length || repairedUncited.length === 0) {
        md = repairedMd;
        uncited = repairedUncited;
      }
    }

    const generatedMs = Date.now() - startedAt;
    const summaryUncited = uncited.length > 0;
    await supabase
      .from('contracts')
      .update({
        summary_md: md,
        summary_status: 'completed',
        summary_uncited: summaryUncited,
        summary_generated_ms: generatedMs,
        summary_error_code: null,
      })
      .eq('id', contract.id)
      .eq('user_id', contract.user_id);
    await Promise.all([
      recordProcessingRun(supabase, { contractId: contract.id, userId: contract.user_id, stage: 'summary', durationMs: generatedMs, outcome: 'success' }),
      recordEvent(supabase, { userId: contract.user_id, contractId: contract.id, eventType: 'summary_generated', durationMs: generatedMs }),
    ]);
    return { summary_md: md, summary_status: 'completed', summary_uncited: summaryUncited, summary_generated_ms: generatedMs };
  } catch (err) {
    const code = err instanceof AppError ? err.code : 'INTERNAL';
    const generatedMs = Date.now() - startedAt;
    await supabase
      .from('contracts')
      .update({ summary_status: 'error', summary_error_code: code, summary_generated_ms: generatedMs })
      .eq('id', contract.id)
      .eq('user_id', contract.user_id);
    await recordProcessingRun(supabase, { contractId: contract.id, userId: contract.user_id, stage: 'summary', durationMs: generatedMs, outcome: 'error', errorCode: code });
    return { summary_md: null, summary_status: 'error', summary_uncited: false, summary_generated_ms: generatedMs, error_code: code };
  }
}
