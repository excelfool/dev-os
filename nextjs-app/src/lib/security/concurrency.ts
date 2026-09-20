import 'server-only';
import { createAdminSupabaseClient } from '@/lib/supabase/admin';
import { appError } from '@/lib/errors/app-error';

/**
 * Postgres-backed semaphore capping in-flight analyses at 100 (spec 13 §6).
 *
 * Not an advisory lock: those are session-scoped and Supabase pools
 * connections, so a slot could leak or be freed by an unrelated request.
 * `analysis_slots` with FOR UPDATE SKIP LOCKED is transaction-scoped,
 * pool-safe, and self-healing after 2 minutes of staleness.
 */
const QUEUE_INTERVAL_MS = 250;
const QUEUE_TIMEOUT_MS = 5_000;

export async function withAnalysisSlot<T>(fn: () => Promise<T>): Promise<T> {
  const admin = createAdminSupabaseClient();
  const holder = crypto.randomUUID();
  const deadline = Date.now() + QUEUE_TIMEOUT_MS;

  let slot: number | null = null;
  while (slot === null) {
    const { data, error } = await admin.rpc('acquire_analysis_slot', { p_holder: holder });
    if (error) throw appError('INTERNAL');

    if (data !== null && data !== undefined) {
      slot = Number(data);
      break;
    }

    if (Date.now() >= deadline) {
      // Queuing rather than degrading is the point: the 101st caller gets an
      // honest message instead of a slow response for everyone.
      throw appError('CAPACITY');
    }
    await new Promise((resolve) => setTimeout(resolve, QUEUE_INTERVAL_MS));
  }

  try {
    return await fn();
  } finally {
    // ALWAYS released, including on throw or timeout.
    const { error } = await admin.rpc('release_analysis_slot', {
      p_slot: slot,
      p_holder: holder,
    });
    if (error) {
      // The 2-minute staleness reclaim is the backstop.
      console.error(JSON.stringify({ concurrency: 'release_failed', slot }));
    }
  }
}
