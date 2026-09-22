import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getServerConfig } from '@/lib/utils/server-config';

/**
 * Cost accounting for every OpenAI attempt (spec 01 §5, spec 14 §3).
 */

export function computeCostUsd(promptTokens: number, completionTokens: number): number {
  const cfg = getServerConfig();
  const usd =
    (promptTokens / 1000) * cfg.OPENAI_INPUT_COST_PER_1K +
    (completionTokens / 1000) * cfg.OPENAI_OUTPUT_COST_PER_1K;
  return Number(usd.toFixed(6));
}

export interface OpenAiCallRow {
  userId: string;
  contractId?: string | null;
  purpose: 'extraction' | 'chat' | 'repair' | 'summary' | 'query_enhancer' | 'judge';
  /** The model id the call was made with (v1.1: per purpose). */
  model?: string;
  promptTokens: number;
  completionTokens: number;
  latencyMs: number;
  attempt: number;
  outcome: 'success' | 'timeout' | 'error' | 'invalid_json';
}

/** One row per attempt, including failed attempts (spec 06 §1). */
export async function recordOpenAiCall(
  supabase: SupabaseClient,
  row: OpenAiCallRow,
): Promise<void> {
  const cfg = getServerConfig();
  const { error } = await supabase.from('openai_calls').insert({
    user_id: row.userId,
    contract_id: row.contractId ?? null,
    purpose: row.purpose,
    model: row.model ?? cfg.OPENAI_MODEL,
    prompt_tokens: row.promptTokens,
    completion_tokens: row.completionTokens,
    cost_usd: computeCostUsd(row.promptTokens, row.completionTokens),
    latency_ms: row.latencyMs,
    attempt: row.attempt,
    outcome: row.outcome,
    prompt_version: cfg.PROMPT_VERSION,
  });

  // Telemetry must never fail the user's request.
  if (error) console.error(JSON.stringify({ telemetry: 'openai_calls', error: error.message }));
}
