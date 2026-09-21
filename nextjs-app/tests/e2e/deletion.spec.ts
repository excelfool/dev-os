import { test, expect } from '@playwright/test';
import { SHORT_NDA } from '../integration/pdf-fixtures';
import { gotoAfterAuth, processedContract } from './helpers';

/**
 * Spec 11 §5 — deleting a contract from the dashboard removes the row and
 * shows the toast; the results page for that id then 404s.
 *
 * CSP honesty: no test in this file would have passed under the broken CSP.
 * The dashboard table is a react-query client component, the delete dialog is
 * Radix, and the confirmation, the optimistic removal and the toast are all
 * client state. Under the broken CSP the table renders from SSR and the delete
 * button does nothing at all.
 */

test.describe('deleting a contract', () => {
  test('removes the row, confirms with a toast, and 404s the results page', async ({ page }) => {
    const contractId = await processedContract(page, SHORT_NDA);
    await gotoAfterAuth(page, '/dashboard');

    const row = page.getByRole('row').filter({ hasText: 'contract.pdf' });
    await expect(row).toBeVisible();

    await row.getByRole('button', { name: 'Delete contract.pdf' }).click();

    // The dialog names the file and says what is destroyed (spec 11 §5 step 1).
    await expect(page.getByRole('dialog')).toContainText('Delete “contract.pdf”?');
    await expect(page.getByRole('dialog')).toContainText('This cannot be undone.');

    await page.getByRole('dialog').getByRole('button', { name: 'Delete', exact: true }).click();

    // Toast FIRST. It appears the moment the DELETE returns and the component
    // clears it 5s later, while the row's disappearance waits on a react-query
    // refetch after router.refresh(). Checking the row first let that wait
    // outlast the toast under full-suite load, and the toast assertion then
    // found nothing — a flake on both engines, passing standalone.
    await expect(page.getByText('Contract and all associated data deleted.')).toBeVisible();
    await expect(row).toHaveCount(0);

    // The contract is gone, not merely hidden from the list.
    const response = await page.request.get(`/api/contracts/${contractId}`);
    expect(response.status()).toBe(404);

    await page.goto(`/contracts/${contractId}`);
    await expect(page.getByRole('region', { name: 'Key terms' })).toHaveCount(0);
  });

  test('cancelling leaves the contract untouched', async ({ page }) => {
    const contractId = await processedContract(page, SHORT_NDA);
    await gotoAfterAuth(page, '/dashboard');

    const row = page.getByRole('row').filter({ hasText: 'contract.pdf' });
    await row.getByRole('button', { name: 'Delete contract.pdf' }).click();

    // Cancel is focused by default, because the destructive action should not
    // be the one a stray Enter hits (DeleteContractDialog).
    const cancel = page.getByRole('dialog').getByRole('button', { name: 'Cancel' });
    await expect(cancel).toBeFocused();
    await cancel.click();

    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(row).toBeVisible();
    expect((await page.request.get(`/api/contracts/${contractId}`)).status()).toBe(200);
  });
});
