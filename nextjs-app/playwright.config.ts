import { defineConfig, devices } from '@playwright/test';
import { SUPABASE_ENV_KEYS, loadTestEnv } from './tests/supabase-guard';

// Refuses to start unless the Supabase URL is a local stack. The resolved
// values are handed to the app explicitly, so a process.env value wins over
// .env.local (Next.js never overrides a variable already set).
const testEnv = loadTestEnv();
const supabaseEnv = Object.fromEntries(
  SUPABASE_ENV_KEYS.filter((key) => testEnv[key]).map((key) => [key, testEnv[key]!]),
);

const PORT = 3200;
// The model stub runs as its own server: Playwright starts the app as a
// separate process, so the in-process stub the integration harness uses is not
// reachable from it (handoff §7 item 1).
const OPENAI_STUB_PORT = 3300;

export default defineConfig({
  testDir: './tests/e2e',
  // Vitest owns tests/**/*.test.ts; Playwright owns *.spec.ts (spec 00 §7).
  testMatch: /.*\.spec\.ts/,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    // The signup gate was reported in both Chrome and Safari, so WebKit is
    // part of the gate, not an optional extra.
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
  webServer: [
    {
      command: `node tests/e2e/openai-stub.mjs`,
      url: `http://127.0.0.1:${OPENAI_STUB_PORT}/__control/requests`,
      reuseExistingServer: false,
      timeout: 30_000,
      env: { OPENAI_STUB_PORT: String(OPENAI_STUB_PORT) },
    },
    {
      command: `npx next dev --port ${PORT}`,
      url: `http://127.0.0.1:${PORT}/api/health`,
      reuseExistingServer: false,
      timeout: 120_000,
      // Its own build directory — sharing `.next` corrupts the webpack runtime.
      env: {
        ...supabaseEnv,
        NEXT_DIST_DIR: '.next-e2e',
        NEXT_TELEMETRY_DISABLED: '1',
        // No billed calls from the E2E suite.
        OPENAI_BASE_URL: `http://127.0.0.1:${OPENAI_STUB_PORT}/v1`,
      },
    },
  ],
});
