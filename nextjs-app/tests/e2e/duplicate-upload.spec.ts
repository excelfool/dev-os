import { expect, test } from '@playwright/test';
import { format } from 'date-fns';
import { SHORT_NDA } from '../integration/pdf-fixtures';
import { gotoAfterAuth, signUp, uploadViaApi } from './helpers';

/**
 * D46 (Stage 5a): a second upload of the same bytes proceeds as a new
 * contract, and the notice survives the wizard's navigation to /prepare.
 */
test('a second upload of the same file shows the duplicate notice on the prepare page', async ({ page }) => {
  await signUp(page, 'dup');
  const firstId = await uploadViaApi(page, SHORT_NDA, 'NDA');

  await gotoAfterAuth(page, '/contracts/new');
  await page.getByRole('combobox', { name: 'Contract type' }).click();
  await page.getByRole('option', { name: 'NDA' }).click();
  await page.locator('input[type="file"]').setInputFiles({
    name: 'nda.pdf',
    mimeType: 'application/pdf',
    buffer: SHORT_NDA,
  });

  await page.waitForURL(/\/contracts\/[0-9a-f-]+\/prepare/, { timeout: 30_000 });
  const secondId = page.url().match(/contracts\/([0-9a-f-]+)\//)![1]!;
  expect(secondId).not.toBe(firstId);

  const banner = page.getByRole('status', { name: 'Duplicate upload' });
  await expect(banner).toBeVisible();
  await expect(banner).toHaveText(
    `You already uploaded this file on ${format(new Date(), 'd MMM yyyy')} — opening the existing analysis is faster.`,
  );
  await expect(banner.getByRole('link', { name: 'existing analysis' })).toHaveAttribute('href', `/contracts/${firstId}`);

  // The notice survives a reload of the prepare page.
  await page.reload();
  await expect(page.getByRole('status', { name: 'Duplicate upload' })).toBeVisible();
});
