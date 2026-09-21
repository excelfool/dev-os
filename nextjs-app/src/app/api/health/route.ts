import { createClient } from '@supabase/supabase-js';
import { publicConfig } from '@/lib/utils/config';
import { BUILD_COMMIT } from '@/generated/build-info';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/health (spec 14 §1) — PUBLIC.
 *
 * Excluded from the middleware matcher so an anonymous Uptime Robot poll never
 * enters updateSession: a cookie refresh on an anonymous poll is wasted work
 * and could turn a DB blip into a 500 on the health check. No auth, no user
 * data, no caching.
 *
 * Uses a bare anon client rather than the cookie-bound server client, because
 * there is no request cookie to bind and `system_status` is readable only by
 * authenticated users — the reachability probe below does not need a row.
 */
const DB_TIMEOUT_MS = 2_000;

export async function GET() {
  // Captured at BUILD time by scripts/write-build-info.mjs. Netlify's
  // COMMIT_REF is a build-time variable that is absent from the function's
  // runtime environment, so a process.env read here reported "dev" live while
  // passing locally, where dev compiles and serves in one process.
  const commit = BUILD_COMMIT;
  const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };

  try {
    const supabase = createClient(publicConfig.supabaseUrl, publicConfig.supabaseAnonKey, {
      auth: { persistSession: false },
    });

    const probe = supabase.from('system_status').select('id', { head: true, count: 'exact' });
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('db timeout')), DB_TIMEOUT_MS),
    );

    // RLS denies the row to anon, which is correct and still proves the
    // database answered. Only a transport/timeout failure is unhealthy.
    await Promise.race([probe, timeout]);

    return new Response(JSON.stringify({ status: 'ok', commit, db: 'ok' }), { status: 200, headers });
  } catch {
    return new Response(JSON.stringify({ status: 'degraded', commit, db: 'error' }), {
      status: 503,
      headers,
    });
  }
}
