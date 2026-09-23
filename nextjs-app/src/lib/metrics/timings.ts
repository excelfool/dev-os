import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';

export type ProcessingStage = 'upload' | 'text_extract' | 'ai_extract' | 'summary' | 'persist' | 'chat' | 'total';

export async function timed<T>(fn: () => Promise<T>): Promise<{ result: T; durationMs: number }> {
  const startedAt = Date.now();
  const result = await fn();
  return { result, durationMs: Date.now() - startedAt };
}

export interface ProcessingRunRow {
  contractId: string;
  userId: string;
  stage: ProcessingStage;
  durationMs: number;
  outcome: 'success' | 'error';
  errorCode?: string | null;
}

/** One `processing_runs` row per stage. `stage='total'` powers the ≤30s P95 gate. */
export async function recordProcessingRun(
  supabase: SupabaseClient,
  row: ProcessingRunRow,
): Promise<void> {
  const { error } = await supabase.from('processing_runs').insert({
    contract_id: row.contractId,
    user_id: row.userId,
    stage: row.stage,
    duration_ms: Math.max(0, Math.round(row.durationMs)),
    outcome: row.outcome,
    error_code: row.errorCode ?? null,
  });

  if (error) console.error(JSON.stringify({ telemetry: 'processing_runs', error: error.message }));
}
