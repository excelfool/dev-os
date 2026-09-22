// Content-Security-Policy for next.config.mjs — spec 13 §3. Plain ESM so the
// config can import it without a build step; typed through JSDoc.

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost']);

/**
 * G42 (2026-09-22): in development only, the origin of a loopback Supabase
 * URL (the local stack, `npm run supabase:start`) — the browser talks to it
 * directly for auth and row reads, and `https://*.supabase.co` does not cover
 * `http://127.0.0.1:54321`. A production build, any other host, or an unset or
 * unparseable URL adds nothing.
 *
 * @param {{ isProduction: boolean, supabaseUrl: string | undefined }} opts
 * @returns {string | null}
 */
export function devSupabaseConnectOrigin({ isProduction, supabaseUrl }) {
  if (isProduction || !supabaseUrl) return null;
  try {
    const url = new URL(supabaseUrl);
    return LOOPBACK_HOSTS.has(url.hostname) ? url.origin : null;
  } catch {
    return null;
  }
}

/**
 * The header value. Production is exactly spec 13 §3. Development adds
 * 'unsafe-eval' (Next's dev runtime needs it to hydrate — spec 13 §3, note of
 * 2026-09-20) and, under G42, a loopback Supabase origin.
 *
 * @param {{ isProduction: boolean, supabaseUrl: string | undefined }} opts
 * @returns {string}
 */
export function buildContentSecurityPolicy({ isProduction, supabaseUrl }) {
  const scriptSrc = isProduction
    ? "script-src 'self' 'unsafe-inline'"
    : "script-src 'self' 'unsafe-inline' 'unsafe-eval'";
  const localSupabase = devSupabaseConnectOrigin({ isProduction, supabaseUrl });
  const connectSrc = localSupabase
    ? `connect-src 'self' https://*.supabase.co ${localSupabase}`
    : "connect-src 'self' https://*.supabase.co";
  return [
    "default-src 'self'",
    scriptSrc,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    connectSrc,
    "worker-src 'self' blob:",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; ');
}
