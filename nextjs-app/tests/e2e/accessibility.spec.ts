import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { SHORT_NDA } from '../integration/pdf-fixtures';
import {
  forceTextViewer,
  gotoAfterAuth,
  NDA_EXTRACTION,
  processedContract,
  scriptStub,
  signUp,
  uploadViaApi,
} from './helpers';

/**
 * Spec 16 §4 item 10 and §7 — axe-core over every route and both viewers,
 * failing on any serious or critical violation. This is a hard CI gate with no
 * override (spec 18 §3).
 *
 * LIGHT THEME ONLY, and that is a gap, not a choice. Spec 16 asks for light
 * and dark. There is no dark theme in the app: no `darkMode` in the Tailwind
 * config, no `dark:` variant anywhere in src/, nothing in globals.css. Emulating
 * `prefers-color-scheme: dark` renders the identical light UI, so a "dark" run
 * would assert nothing while reporting coverage. Recorded as an open item
 * instead.
 *
 * CSP honesty: this is the one file where most tests WOULD have passed under
 * the broken CSP, and that is worth being precise about. axe reads the rendered
 * DOM, and most of these routes are server-rendered, so their markup — headings,
 * labels, landmarks, contrast — is present without hydration. The exceptions
 * are the three that assert on client-rendered DOM: both viewer tests (the
 * viewer is chosen after a client fetch, so the panel would be absent entirely)
 * and the open-chat test. The static-route scans are genuine accessibility
 * coverage but they are NOT evidence that the page works.
 */

/** Serious and critical only, per the spec's gate. */
async function scan(page: Page, context?: string) {
  const results = await new AxeBuilder({ page }).analyze();
  const blocking = results.violations.filter(
    (v) => v.impact === 'serious' || v.impact === 'critical',
  );

  if (blocking.length > 0) {
    const detail = blocking
      .map((v) => `${v.impact} · ${v.id} · ${v.help}\n    ${v.nodes.map((n) => n.target.join(' ')).join('\n    ')}`)
      .join('\n\n');
    throw new Error(`axe found ${blocking.length} serious/critical violation(s)${context ? ` on ${context}` : ''}:\n\n${detail}`);
  }

  expect(blocking).toEqual([]);
}

test.describe('accessibility — unauthenticated routes', () => {
  for (const path of ['/', '/signup', '/login', '/legal/terms', '/legal/privacy']) {
    test(`${path} has no serious or critical violations`, async ({ page }) => {
      await page.goto(path);
      await scan(page, path);
    });
  }

  test('the signup form is still clean once it is showing errors', async ({ page }) => {
    // The error state is the one deviation 8 made unreachable; it has its own
    // aria wiring, so it gets its own scan.
    await page.goto('/signup');
    await page.getByLabel('Password').fill('short');
    await page.getByLabel('Email').fill('not-an-email');
    await expect(page.getByText('Enter a valid email address.')).toBeVisible();
    await scan(page, '/signup with errors');
  });
});

test.describe('accessibility — authenticated routes', () => {
  test('dashboard, upload and settings have no serious or critical violations', async ({ page }) => {
    await signUp(page, 'a11y');

    await scan(page, '/dashboard (empty)');

    await gotoAfterAuth(page, '/contracts/new');
    await scan(page, '/contracts/new');

    await gotoAfterAuth(page, '/settings');
    await scan(page, '/settings');
  });

  test('the prepare screen has no serious or critical violations', async ({ page }) => {
    await signUp(page, 'a11yprep');
    await scriptStub(page.request, [NDA_EXTRACTION]);
    const contractId = await uploadViaApi(page, SHORT_NDA);

    await gotoAfterAuth(page, `/contracts/${contractId}/prepare`);
    await expect(page.getByRole('button', { name: 'Process Contract' })).toBeVisible();
    await scan(page, '/contracts/[id]/prepare');
  });

  test('the dashboard with a contract in it has no serious or critical violations', async ({
    page,
  }) => {
    await processedContract(page, SHORT_NDA);
    await gotoAfterAuth(page, '/dashboard');
    await expect(page.getByRole('table')).toBeVisible();
    await scan(page, '/dashboard (populated)');
  });
});

test.describe('accessibility — both viewers', () => {
  test('the results page with the PDF viewer has no serious or critical violations', async ({
    page,
  }) => {
    const contractId = await processedContract(page, SHORT_NDA);
    await gotoAfterAuth(page, `/contracts/${contractId}`);
    await expect(page.locator('[data-page="1"]')).toBeVisible({ timeout: 30_000 });
    await scan(page, 'results + PdfViewer');
  });

  test('the results page with the text viewer has no serious or critical violations', async ({
    page,
  }) => {
    const contractId = await processedContract(page, SHORT_NDA);
    await forceTextViewer(page, contractId);
    await gotoAfterAuth(page, `/contracts/${contractId}`);
    await expect(page.getByRole('region', { name: 'Page 1' })).toBeVisible({ timeout: 30_000 });
    await scan(page, 'results + TextViewer');
  });

  test('the open chat panel has no serious or critical violations', async ({ page }) => {
    const contractId = await processedContract(page, SHORT_NDA);
    await gotoAfterAuth(page, `/contracts/${contractId}`);
    await page.getByRole('button', { name: 'Chat with Contract' }).click();
    await expect(page.getByLabel('Ask a question about this contract')).toBeVisible();
    await scan(page, 'results + open chat');
  });
});
