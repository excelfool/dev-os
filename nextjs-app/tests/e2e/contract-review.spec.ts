import { test, expect } from '@playwright/test';
import { SHORT_NDA } from '../integration/pdf-fixtures';
import { NDA_EXTRACTION, processedContract, scriptStub, signUp, gotoAfterAuth } from './helpers';

/**
 * Spec 04 §7, 05 §6, 07 §8, 10 §6 — the core journey, end to end, in a browser:
 * upload → prepare → process → results → edit → complete → dashboard.
 *
 * Every step here is client-driven. The wizard is a `useReducer` context, the
 * dropzone is a hydrated control, the prepare screen posts and routes on the
 * client, and inline editing is entirely client state. Under the broken CSP
 * (deviation 7) NONE of this file would have passed — the first assertion after
 * choosing a contract type would already fail, because the Radix select never
 * opens without hydration.
 */

const CUSTOM_TERM = 'Non-compete radius';

test.describe('the full contract review journey', () => {
  test('upload through the wizard, add a custom term, process, edit, complete', async ({
    page,
  }) => {
    await signUp(page, 'review');
    await scriptStub(page.request, [NDA_EXTRACTION]);

    // --- upload -----------------------------------------------------------
    await gotoAfterAuth(page, '/contracts/new');

    // The dropzone is locked until a contract type is chosen (spec 04 §1).
    await expect(page.getByText('Choose a contract type first.')).toBeVisible();

    await page.getByRole('combobox', { name: 'Contract type' }).click();
    await page.getByRole('option', { name: 'NDA' }).click();
    await expect(page.getByText('Drag a PDF here, or browse')).toBeVisible();

    await page.locator('input[type="file"]').setInputFiles({
      name: 'nda.pdf',
      mimeType: 'application/pdf',
      buffer: SHORT_NDA,
    });

    // --- prepare ----------------------------------------------------------
    await page.waitForURL(/\/contracts\/[0-9a-f-]+\/prepare/, { timeout: 30_000 });
    const contractId = page.url().match(/contracts\/([0-9a-f-]+)\//)![1]!;

    await expect(page.getByRole('heading', { name: /will look for these \d+ terms/ })).toBeVisible();
    await expect(page.getByText('Governing Law')).toBeVisible();

    // A custom term is added on the client and shows its own badge.
    await page.getByRole('button', { name: 'Add Key Term' }).click();
    await page.getByLabel('Add a key term').fill(CUSTOM_TERM);
    await page.getByRole('button', { name: 'Add', exact: true }).click();

    const customRow = page.locator('li').filter({ hasText: CUSTOM_TERM });
    await expect(customRow.getByText('Custom')).toBeVisible();

    // --- process ----------------------------------------------------------
    await page.getByRole('button', { name: 'Process Contract' }).click();

    // --- results ----------------------------------------------------------
    await page.waitForURL(`**/contracts/${contractId}`, { timeout: 60_000 });

    const terms = page.getByRole('region', { name: 'Key terms' });
    await expect(terms.getByText('State of Delaware')).toBeVisible();
    await expect(terms.getByRole('button', { name: 'Page 1' }).first()).toBeVisible();

    // --- inline edit ------------------------------------------------------
    await terms.getByRole('button', { name: 'State of Delaware' }).click();
    const editor = page.getByLabel('Edit extracted value');
    await editor.fill('State of New York');
    await editor.press('Enter');

    await expect(terms.getByText('State of New York')).toBeVisible();
    await expect(terms.getByText('Edited')).toBeVisible();

    // --- mark complete ----------------------------------------------------
    await page.getByRole('button', { name: 'Mark review complete' }).click();
    // Spec 10 §1 requires both the toast AND the completed state.
    await expect(page.getByText('Review marked complete')).toBeVisible();
    await expect(page.getByText(/Review complete · /)).toBeVisible();

    // --- dashboard --------------------------------------------------------
    await page.goto('/dashboard');
    const row = page.getByRole('row').filter({ hasText: 'nda.pdf' });
    await expect(row.getByText('Review complete')).toBeVisible();
  });

  test('a thumbs-up on the review persists across a reload', async ({ page }) => {
    // Spec 10 §6 names this file for the feedback widget.
    const contractId = await processedContract(page, SHORT_NDA);
    await page.goto(`/contracts/${contractId}`);

    const feedback = page.getByRole('region', { name: 'Feedback' });
    const thumbsUp = feedback.getByRole('button', { name: 'This review was accurate' });

    await expect(thumbsUp).toHaveAttribute('aria-pressed', 'false');
    await thumbsUp.click();
    await expect(feedback.getByText('Thanks — this helps us improve.')).toBeVisible();

    await page.reload();
    await expect(
      page.getByRole('region', { name: 'Feedback' })
        .getByRole('button', { name: 'This review was accurate' }),
    ).toHaveAttribute('aria-pressed', 'true');
  });
});
