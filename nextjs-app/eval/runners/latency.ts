import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * P95 upload→results and chat latency from processing_runs / chat_messages
 * (spec 17 §2, ≤ 30s / ≤ 15s). These are PRODUCTION observations, not
 * something the eval generates — so on a database with no traffic this
 * correctly reports null rather than a number invented from eval runs.
 */
function p95(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(0.95 * sorted.length) - 1)]!;
}

export async function latency(supabase: SupabaseClient) {
  const { data: runs } = await supabase
    .from('processing_runs')
    .select('duration_ms')
    .eq('stage', 'total')
    .not('duration_ms', 'is', null);

  const { data: chats } = await supabase
    .from('chat_messages')
    .select('latency_ms')
    .eq('role', 'assistant')
    .not('latency_ms', 'is', null);

  const processingValues = (runs ?? []).map((r) => Number(r.duration_ms));
  const chatValues = (chats ?? []).map((c) => Number(c.latency_ms));

  return {
    processingP95Ms: p95(processingValues),
    processingSamples: processingValues.length,
    chatP95Ms: p95(chatValues),
    chatSamples: chatValues.length,
  };
}
