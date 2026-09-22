import { buildContentSecurityPolicy } from './src/lib/security/csp.mjs';

// Security headers — spec 13 §3. `worker-src blob:` is required by the PDF.js
// worker; the OpenAI origin is deliberately absent because the browser never
// talks to OpenAI.
// Next's dev server compiles with eval-based source maps and react-refresh, so
// a CSP without 'unsafe-eval' silently kills hydration in development: the page
// renders from SSR but no client component ever becomes interactive. It looks
// like a frozen UI, not a security header. Production is exactly as spec 13 §3
// specifies — 'unsafe-eval' is added ONLY when not building for production.
// G42: in development a loopback NEXT_PUBLIC_SUPABASE_URL (the local stack) is
// also added to connect-src; see src/lib/security/csp.mjs.
const isProduction = process.env.NODE_ENV === 'production';

const securityHeaders = [
  {
    key: 'Content-Security-Policy',
    value: buildContentSecurityPolicy({
      isProduction,
      supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
    }),
  },
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Lets the integration harness compile into its own directory. Sharing
  // `.next` between a running dev server and another `next dev`/`next build`
  // corrupts the webpack runtime ("__webpack_modules__[moduleId] is not a
  // function"), which is a confusing failure to debug from a test.
  distDir: process.env.NEXT_DIST_DIR || '.next',
  reactStrictMode: true,
  // Next sends `X-Powered-By: Next.js` by default. It is free version
  // disclosure: it tells a scanner which framework to look up advisories for,
  // and this app is pinned to next@14.2.5, which carries a known advisory
  // chain. Nothing depends on the header.
  poweredByHeader: false,
  // `next build` must fail on any type error (spec 00 §6).
  typescript: { ignoreBuildErrors: false },
  eslint: { ignoreDuringBuilds: false },
  // Next 14 keeps this under `experimental`; it stops the bundler from
  // trying to bundle pdf-parse, which must stay a Node require.
  experimental: { serverComponentsExternalPackages: ['pdf-parse'] },
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
};

export default nextConfig;
