/**
 * Background processing function (spec 06 v1.1 §G, D49 a).
 *
 * The `-background` suffix makes Netlify queue the invocation and answer 202
 * immediately; the function then has a 15-minute ceiling, of which the
 * pipeline uses at most PROCESS_JOB_BUDGET_MS (120 s). Invoked only by
 * `POST /api/contracts/{id}/process` with an HMAC-signed body — see
 * src/lib/security/process-job-signature.ts.
 *
 * Bundling: this file is packaged by Netlify's esbuild, not by Next.js, so the
 * app modules' `import 'server-only'` guard would throw at load (that package
 * throws outside a React Server environment by design). `server-only` is
 * marked external for this function in netlify.toml and neutralised below by
 * pre-seeding the require cache with an empty module BEFORE the app code is
 * loaded — hence the dynamic import.
 *
 * Runtime (L3, live 2026-09-22): Netlify runs this function on nodejs20.x,
 * which has no global WebSocket, and @supabase/supabase-js ≥ 2.116 refuses to
 * construct a client without one ("Node.js detected but native WebSocket not
 * found") — so the job died inside createAdminSupabaseClient, after the
 * signature check and before any database write, and the row sat in
 * `processing` until the reclaim cron. The Next.js server handler provides
 * that global itself, which is why the inline route never hit it.
 * `ensureWebSocket` installs `ws` as the global before the app code loads.
 * Nothing else about the pipeline differs from the inline route.
 */
import Module from 'node:module';

export async function ensureWebSocket(): Promise<'native' | 'ws'> {
  if (typeof globalThis.WebSocket === 'function') return 'native';
  const ws = await import('ws');
  (globalThis as unknown as { WebSocket: unknown }).WebSocket = ws.WebSocket ?? ws.default;
  return 'ws';
}

function neutraliseServerOnlyGuard(): void {
  if (typeof require !== 'function') return; // ESM test runner: the alias in vitest.config.ts handles it
  let resolved: string;
  try {
    resolved = require.resolve('server-only');
  } catch {
    return;
  }
  if (require.cache[resolved]) return;
  const stub = new Module(resolved);
  stub.filename = resolved;
  stub.loaded = true;
  stub.exports = {};
  require.cache[resolved] = stub;
}

export default async function handler(request: Request): Promise<Response> {
  if (request.method !== 'POST') return new Response('method not allowed', { status: 405 });

  neutraliseServerOnlyGuard();
  await ensureWebSocket();
  const { runProcessJob, PROCESS_JOB_SIGNATURE_HEADER } = await import('../../src/lib/services/process-job-runner');

  const rawBody = await request.text();
  const outcome = await runProcessJob(rawBody, request.headers.get(PROCESS_JOB_SIGNATURE_HEADER));
  return new Response(JSON.stringify(outcome.body), {
    status: outcome.status,
    headers: { 'content-type': 'application/json' },
  });
}
