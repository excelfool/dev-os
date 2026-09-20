import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // The RLS suite talks to a real Supabase project, so it needs a longer
    // budget than a pure unit test and must not run its accounts in parallel.
    testTimeout: 30_000,
    hookTimeout: 120_000,
    fileParallelism: false,
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
      // See tests/stubs/server-only.ts — the real guard still applies to builds.
      'server-only': resolve(__dirname, 'tests/stubs/server-only.ts'),
    },
  },
});
