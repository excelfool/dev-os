import { defineConfig, devices } from '@playwright/test';

const PORT = 3200;

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
  webServer: {
    command: `npx next dev --port ${PORT}`,
    url: `http://127.0.0.1:${PORT}/api/health`,
    reuseExistingServer: false,
    timeout: 120_000,
    // Its own build directory — sharing `.next` corrupts the webpack runtime.
    env: { NEXT_DIST_DIR: '.next-e2e', NEXT_TELEMETRY_DISABLED: '1' },
  },
});
