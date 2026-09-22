import { test, expect } from '@playwright/test';
import { loadTestEnv } from '../supabase-guard';

/**
 * Spec 13 §3 — the response headers, asserted against a real server.
 *
 * These had no test at all: the production CSP was checked by hand during
 * Stage 4 and never pinned, which is why a manual header check on localhost
 * was what noticed `X-Powered-By` still going out.
 *
 * CSP honesty: every test here would have passed under the broken CSP. Headers
 * are attached by the server and owe nothing to hydration. That is the point —
 * a green run here says the headers are right, and says nothing at all about
 * whether the page works.
 */

/** Spec 13 §3, verbatim — the production CSP. */
const SPEC_13_CSP =
  "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self' https://*.supabase.co; worker-src 'self' blob:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'";

/**
 * Playwright runs the app under `next dev` (playwright.config.ts), so the CSP
 * it receives is the DEVELOPMENT header: spec 13 §3 plus exactly two declared
 * deviations — 'unsafe-eval' (spec 13 §3 note, 2026-09-20) and the loopback
 * Supabase origin in connect-src (G42). The guard guarantees that URL is
 * loopback.
 */
const LOCAL_SUPABASE_ORIGIN = new URL(loadTestEnv().NEXT_PUBLIC_SUPABASE_URL!).origin;
const DEV_CSP = SPEC_13_CSP.replace(
  "script-src 'self' 'unsafe-inline';",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval';",
).replace(
  "connect-src 'self' https://*.supabase.co;",
  `connect-src 'self' https://*.supabase.co ${LOCAL_SUPABASE_ORIGIN};`,
);

test.describe('security headers', () => {
  test('the framework is not advertised', async ({ request }) => {
    const response = await request.get('/');
    // Next sends `X-Powered-By: Next.js` unless poweredByHeader is disabled.
    // It is free version disclosure — it tells a scanner which framework to
    // look up advisories for, and this app is pinned to next@14.2.5, which
    // carries a known advisory chain.
    expect(response.headers()['x-powered-by']).toBeUndefined();
  });

  test('every header spec 13 §3 requires is present', async ({ request }) => {
    const headers = (await request.get('/')).headers();

    expect(headers['strict-transport-security']).toBe(
      'max-age=63072000; includeSubDomains; preload',
    );
    expect(headers['x-content-type-options']).toBe('nosniff');
    expect(headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
    expect(headers['x-frame-options']).toBe('DENY');
    expect(headers['permissions-policy']).toBe('camera=(), microphone=(), geolocation=()');

    const csp = headers['content-security-policy']!;
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("base-uri 'self'");
    expect(csp).toContain("form-action 'self'");
  });

  test('the development CSP is exactly spec 13 §3 plus the two declared dev deviations', async ({ request }) => {
    const csp = (await request.get('/')).headers()['content-security-policy'];
    expect(csp).toBe(DEV_CSP);
  });

  test('removing the dev deviations leaves the production CSP byte for byte', async ({ request }) => {
    // Separate from the test above on purpose: a change to any directive the
    // production header shares fails here with the production string in the
    // diff, not only as a dev-header mismatch.
    const csp = (await request.get('/')).headers()['content-security-policy']!;
    const production = csp
      .replace(" 'unsafe-eval'", '')
      .replace(` ${LOCAL_SUPABASE_ORIGIN}`, '');
    expect(production).toBe(SPEC_13_CSP);
  });

  test('X-XSS-Protection is deliberately absent', async ({ request }) => {
    /**
     * This is an assertion of ABSENCE, and it is deliberate. The header is
     * deprecated: Chrome removed the XSS Auditor in v78, Edge dropped it, and
     * Firefox never shipped it, so on a current browser it does nothing.
     *
     * Where it still does something it has been harmful. The auditor's
     * filtering was itself exploitable — it could be induced to block
     * legitimate script or to leak cross-origin information, which is why
     * `X-XSS-Protection: 1; mode=block` is now considered a liability rather
     * than a control. OWASP's guidance is to omit it, or send `0`, and rely on
     * Content-Security-Policy.
     *
     * The real control is the CSP asserted above. If a reader adds this header
     * back because a checklist lists it, this test fails and points here.
     */
    const headers = (await request.get('/')).headers();
    expect(headers['x-xss-protection']).toBeUndefined();
  });
});
