import 'server-only';
import { createAdminSupabaseClient } from '@/lib/supabase/admin';
import { getServerConfig } from '@/lib/utils/server-config';
import { appError } from '@/lib/errors/app-error';

/**
 * Postgres-backed fixed-window counters (spec 13 §4). No extra infrastructure.
 *
 * `increment_rate_limit` is revoked from public/anon/authenticated and granted
 * to service_role only, so this is one of the sanctioned admin-client call
 * sites (spec 13 §2 item 4). Clients cannot read or reset their own counters:
 * `rate_limits` has RLS enabled with no policies.
 */
export type RateLimitBucket = 'upload' | 'process' | 'chat';

function limitFor(bucket: RateLimitBucket): number {
  const cfg = getServerConfig();
  switch (bucket) {
    case 'upload':
      return cfg.RATE_LIMIT_UPLOAD_PER_HOUR;
    case 'process':
      return cfg.RATE_LIMIT_PROCESS_PER_HOUR;
    case 'chat':
      return cfg.RATE_LIMIT_CHAT_PER_HOUR;
  }
}

/** Seconds remaining in the current truncated-hour window. */
function secondsUntilWindowEnd(now = new Date()): number {
  const nextHour = new Date(now);
  nextHour.setUTCMinutes(0, 0, 0);
  nextHour.setUTCHours(nextHour.getUTCHours() + 1);
  return Math.max(1, Math.ceil((nextHour.getTime() - now.getTime()) / 1000));
}

export async function enforceRateLimit(userId: string, bucket: RateLimitBucket): Promise<void> {
  const limit = limitFor(bucket);
  const admin = createAdminSupabaseClient();

  const { data, error } = await admin.rpc('increment_rate_limit', {
    p_user_id: userId,
    p_bucket: bucket,
    p_limit: limit,
  });

  // A rate-limiter outage must not silently disable the limiter, but it must
  // also not take the product down. Fail closed only on a definite answer.
  if (error) throw appError('INTERNAL');

  const count = typeof data === 'number' ? data : Number(data);
  if (count > limit) {
    const retryAfterSeconds = secondsUntilWindowEnd();
    const minutes = Math.max(1, Math.ceil(retryAfterSeconds / 60));
    throw appError('RATE_LIMITED', { minutes }, { retryAfterSeconds });
  }
}
