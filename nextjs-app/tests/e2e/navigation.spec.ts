import { test, expect, type Page } from '@playwright/test';
import { makePdf } from '../integration/pdf-fixtures';
import { forceTextViewer, processedContract } from './helpers';

/**
 * Spec 07 §8 — clicking a page chip scrolls the viewer to that page and flashes
 * the highlight, in BOTH viewers. The whole point of the `DocumentViewerProps`
 * contract is that the rest of the app never branches on which viewer is
 * mounted, so the same interaction is asserted twice.
 *
 * CSP honesty: no test in this file would have passed under the broken CSP.
 * Page chips are buttons wired to the `useTargetPage` context, and both
 * viewers scroll from an effect — all of it hydration-only. Under the broken
 * CSP the chips render in the SSR HTML and do nothing at all when clicked,
 * which is exactly the failure mode deviation 7 describes.
 */

const PAGE_2_SENTENCE = 'The liability cap is five million dollars in aggregate.';
const PAGE_3_SENTENCE = 'Either party may terminate on thirty days written notice.';

/** 46 lines per page, so these land on pages 1, 2 and 3. */
function threePageContract(): Buffer {
  const lines: string[] = [];
  const filler = (page: number, count: number) => {
    for (let i = 0; i < count; i += 1) lines.push(`Page ${page} clause ${i + 1} of this agreement.`);
  };
  lines.push('MASTER SERVICES AGREEMENT');
  lines.push('This Agreement is governed by the laws of the State of Delaware.');
  filler(1, 44);
  lines.push(PAGE_2_SENTENCE);
  filler(2, 45);
  lines.push(PAGE_3_SENTENCE);
  filler(3, 45);
  return makePdf(lines.join('\n'));
}

const EXTRACTION = JSON.stringify({
  detected_type: 'MSA',
  terms: [
    {
      term_name: 'Governing Law',
      value: 'State of Delaware',
      page_number: 1,
      confidence_score: 0.95,
      source_sentence: 'This Agreement is governed by the laws of the State of Delaware.',
    },
    {
      term_name: 'Liability Cap',
      value: 'Five million dollars',
      page_number: 2,
      confidence_score: 0.91,
      source_sentence: PAGE_2_SENTENCE,
    },
    {
      term_name: 'Termination Clause',
      value: 'Thirty days written notice',
      page_number: 3,
      confidence_score: 0.87,
      source_sentence: PAGE_3_SENTENCE,
    },
  ],
});

function terms(page: Page) {
  return page.getByRole('region', { name: 'Key terms' });
}

test.describe('page-chip navigation', () => {
  test('scrolls the PDF viewer to the cited page', async ({
    page,
  }) => {
    const contractId = await processedContract(page, threePageContract(), EXTRACTION, 'MSA');
    await page.goto(`/contracts/${contractId}`);

    const pdfPage1 = page.locator('[data-page="1"]');
    await expect(pdfPage1).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('[data-page="3"]')).not.toBeInViewport();

    await terms(page)
      .locator('li')
      .filter({ hasText: 'Termination Clause' })
      .getByRole('button', { name: 'Page 3' })
      .click();

    await expect(page.locator('[data-page="3"]')).toBeInViewport({ timeout: 15_000 });
  });

  test('scrolls the text viewer to the cited page and flashes the source sentence', async ({
    page,
  }) => {
    const contractId = await processedContract(page, threePageContract(), EXTRACTION, 'MSA');
    await forceTextViewer(page, contractId);
    await page.goto(`/contracts/${contractId}`);

    const page2 = page.getByRole('region', { name: 'Page 2' });
    await expect(page2).toBeVisible({ timeout: 30_000 });
    await expect(page2).not.toBeInViewport();

    await terms(page)
      .locator('li')
      .filter({ hasText: 'Liability Cap' })
      .getByRole('button', { name: 'Page 2' })
      .click();

    await expect(page2).toBeInViewport({ timeout: 15_000 });

    // The highlight lands on the real sentence, not just the page.
    const flash = page.locator('mark.highlight-flash');
    await expect(flash).toHaveCount(1);
    await expect(flash).toContainText('liability cap is five million dollars');
  });

  test('re-flashes when the same page chip is clicked twice', async ({ page }) => {
    // The `nonce` exists so repeat navigation to the page you are already on
    // still re-renders the mark (use-target-page.ts).
    const contractId = await processedContract(page, threePageContract(), EXTRACTION, 'MSA');
    await forceTextViewer(page, contractId);
    await page.goto(`/contracts/${contractId}`);

    const chip = terms(page)
      .locator('li')
      .filter({ hasText: 'Liability Cap' })
      .getByRole('button', { name: 'Page 2' });

    await chip.click();
    await expect(page.locator('mark.highlight-flash')).toHaveCount(1);

    await chip.click();
    await expect(page.locator('mark.highlight-flash')).toHaveCount(1);
    await expect(page.locator('mark.highlight-flash')).toContainText('liability cap');
  });
});
