import { describe, expect, it } from 'vitest';
import { buildContentSecurityPolicy, devSupabaseConnectOrigin } from '@/lib/security/csp.mjs';

/**
 * Spec 13 §3 and G42. The production header is pinned byte for byte; the only
 * development deviations are 'unsafe-eval' and a loopback Supabase origin.
 */

// Spec 13 §3, verbatim. A change here is a production security change.
const SPEC_13_CSP =
  "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self' https://*.supabase.co; worker-src 'self' blob:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'";

const HOSTED = 'https://abcdefghijklmnopqrst.supabase.co';

describe('production CSP (spec 13 §3)', () => {
  it.each([
    ['a hosted project', HOSTED],
    ['a loopback URL', 'http://127.0.0.1:54321'],
    ['an unset URL', undefined],
  ])('is byte-identical to the spec with %s', (_label, supabaseUrl) => {
    expect(buildContentSecurityPolicy({ isProduction: true, supabaseUrl })).toBe(SPEC_13_CSP);
  });
});

describe('devSupabaseConnectOrigin (G42)', () => {
  it.each([
    ['http://127.0.0.1:54321', 'http://127.0.0.1:54321'],
    ['http://localhost:54321/', 'http://localhost:54321'],
    ['http://127.0.0.1:54321/rest/v1', 'http://127.0.0.1:54321'],
  ])('a loopback URL %s adds its origin', (supabaseUrl, origin) => {
    expect(devSupabaseConnectOrigin({ isProduction: false, supabaseUrl })).toBe(origin);
    expect(buildContentSecurityPolicy({ isProduction: false, supabaseUrl })).toContain(
      `connect-src 'self' https://*.supabase.co ${origin};`,
    );
  });

  it.each([
    ['a *.supabase.co URL', HOSTED],
    ['an unset URL', undefined],
    ['an empty URL', ''],
    ['an unparseable URL', 'not a url'],
    ['a lookalike host', 'http://127.0.0.1.example.com:54321'],
  ])('%s adds nothing', (_label, supabaseUrl) => {
    expect(devSupabaseConnectOrigin({ isProduction: false, supabaseUrl })).toBeNull();
    expect(buildContentSecurityPolicy({ isProduction: false, supabaseUrl })).toBe(
      SPEC_13_CSP.replace("'unsafe-inline';", "'unsafe-inline' 'unsafe-eval';"),
    );
  });

  it('a production build adds nothing even for a loopback URL', () => {
    expect(devSupabaseConnectOrigin({ isProduction: true, supabaseUrl: 'http://127.0.0.1:54321' })).toBeNull();
  });
});
