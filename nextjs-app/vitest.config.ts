import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  test: {
    environment: 'node',
    // `.tsx` for the component tests (spec 07 v1.1 §G).
    include: ['tests/**/*.test.{ts,tsx}'],
    // The RLS suite talks to a real Supabase project, so it needs a longer
    // budget than a pure unit test and must not run its accounts in parallel.
    testTimeout: 30_000,
    hookTimeout: 120_000,
    fileParallelism: false,
  },
  // Next.js compiles JSX with the automatic runtime; tsconfig says `preserve`,
  // which esbuild maps to the classic transform and would need React in scope
  // in every component test. Stating it here keeps the tests matching the app.
  esbuild: { jsx: 'automatic' },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
      // See tests/stubs/server-only.ts — the real guard still applies to builds.
      'server-only': resolve(__dirname, 'tests/stubs/server-only.ts'),
    },
  },
});
