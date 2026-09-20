import { test, expect, type Page } from '@playwright/test';
import { SHORT_NDA } from '../integration/pdf-fixtures';
import { forceTextViewer, NDA_EXTRACTION, processedContract } from './helpers';

/**
 * Spec 07 §2 — viewer selection and its two fallbacks:
 *
 *   file_path != null AND PDF.js renders -> PdfViewer
 *   file_path != null AND PDF.js throws  -> TextViewer + "Download PDF"
 *   file_path == null                    -> TextViewer, no download offered
 *
 * The contract the rest of the app depends on is that a fallback is never a
 * degraded page: every key term is still there, and the review is still doable.
 *
 * What is simulated, and what is not. The server-side half — an upload whose
 * Storage write fails and records `storage_available: false` — needs the
 * Supabase pass-through proxy, which is in-process with the integration
 * harness and cannot be reached from a browser-driven server; the integration
 * suite covers it. What these tests drive is the client boundary: the exact
 * responses the server returns in those states, and the branch the viewer
 * takes on each.
 *
 * CSP honesty: none of these tests would have passed under the broken CSP —
 * but for a subtler reason than the other files. Viewer selection happens
 * entirely on the client, from the result of a fetch made after hydration.
 * With no hydration there is no viewer at all: not the PDF one, not the
 * fallback. The page would look rendered and show neither.
 */

function documentPanel(page: Page) {
  return page.getByRole('region', { name: 'Page 1' });
}

test.describe('when the PDF cannot be shown', () => {
  test('a missing file falls back to the text viewer with every term intact', async ({ page }) => {
    const contractId = await processedContract(page, SHORT_NDA);
    await forceTextViewer(page, contractId);
    await page.goto(`/contracts/${contractId}`);

    // The text viewer is mounted, and the PDF canvas never is.
    await expect(documentPanel(page)).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('[data-page="1"]')).toHaveCount(0);

    // The contract text itself is readable.
    await expect(documentPanel(page)).toContainText('State of Delaware');

    // Every extracted term is still present and still navigable.
    const terms = page.getByRole('region', { name: 'Key terms' });
    await expect(terms.getByText('State of Delaware')).toBeVisible();
    await expect(terms.getByText('Two years from the Effective Date')).toBeVisible();
    await expect(terms.getByRole('button', { name: 'Page 1' }).first()).toBeVisible();

    // NO_FILE is an expected state, not an error: nothing is offered to
    // download, because there is nothing to download.
    await expect(page.getByRole('button', { name: 'Download PDF' })).toHaveCount(0);
  });

  test('a render failure keeps the PDF on offer alongside the text', async ({ page }) => {
    const contractId = await processedContract(page, SHORT_NDA);

    // A signed URL that is handed back but cannot be loaded is the
    // SIGNED_URL_FAILED / render-failure branch: the file exists, PDF.js
    // cannot show it.
    await page.route(`**/api/contracts/${contractId}/signed-url`, (route) =>
      route.fulfill({ status: 500, contentType: 'application/json', body: '{}' }),
    );
    await page.goto(`/contracts/${contractId}`);

    await expect(documentPanel(page)).toBeVisible({ timeout: 30_000 });
    await expect(
      page.getByText("We couldn't display the PDF — showing the contract text instead."),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Download PDF' })).toBeVisible();

    const terms = page.getByRole('region', { name: 'Key terms' });
    await expect(terms.getByText('State of Delaware')).toBeVisible();
  });

  test('the review is still completable from the fallback viewer', async ({ page }) => {
    // The fallback must not be a read-only dead end (spec 07 §2).
    const contractId = await processedContract(page, SHORT_NDA);
    await forceTextViewer(page, contractId);
    await page.goto(`/contracts/${contractId}`);

    const terms = page.getByRole('region', { name: 'Key terms' });
    await terms.getByRole('button', { name: 'State of Delaware' }).click();
    const editor = page.getByLabel('Edit extracted value');
    await editor.fill('State of New York');
    await editor.press('Enter');

    await expect(terms.getByText('State of New York')).toBeVisible();
    await expect(terms.getByText('Edited')).toBeVisible();

    await page.getByRole('button', { name: 'Mark review complete' }).click();
    await expect(page.getByText(/Review complete · /)).toBeVisible();
  });
});
