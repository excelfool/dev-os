import { test, expect, type Page } from '@playwright/test';
import { SHORT_NDA } from '../integration/pdf-fixtures';
import { NDA_EXTRACTION, scriptStub, signUp, gotoAfterAuth } from './helpers';

/**
 * Spec 16 §7 — the entire core flow completed with the keyboard only:
 * upload → preview → custom term → process → results → edit → chat.
 *
 * Every interaction below is reached by Tab and driven by Enter, Space or
 * typing. Nothing is clicked. Where the flow cannot be keyboard-driven at all,
 * that is the finding, not a reason to reach for the mouse.
 *
 * The one unavoidable exception is choosing the file itself: the OS file picker
 * is outside the page, so `setInputFiles` stands in for it. The control that
 * OPENS the picker is exercised from the keyboard, which is the part the app
 * owns — spec 04 §1 requires the dropzone to be operable by keyboard, and it
 * carries role="button" and its own Enter/Space handler for exactly that.
 *
 * CSP honesty: no test in this file would have passed under the broken CSP.
 * Keyboard operation IS hydration — every handler under test here is a React
 * event handler. Focus order alone would survive, and nothing else.
 */

/** Tabs until the predicate matches, so the test asserts reachability. */
async function tabTo(page: Page, matches: () => Promise<boolean>, limit = 40): Promise<void> {
  for (let i = 0; i < limit; i += 1) {
    if (await matches()) return;
    await page.keyboard.press('Tab');
  }
  const focused = await page.evaluate(() => {
    const el = document.activeElement;
    return el ? `${el.tagName}[${el.getAttribute('aria-label') ?? el.textContent?.slice(0, 40)}]` : 'none';
  });
  throw new Error(`Never reached the target by Tab within ${limit} presses. Focus stopped at ${focused}`);
}

function focusedMatches(page: Page, locatorFactory: () => ReturnType<Page['locator']>) {
  return async () => {
    const handle = await locatorFactory().elementHandle({ timeout: 1000 }).catch(() => null);
    if (!handle) return false;
    return page.evaluate((el) => el === document.activeElement, handle);
  };
}

test.describe('the core flow, keyboard only', () => {
  /**
   * Chromium only, and not because the app misbehaves in WebKit. Safari's Tab
   * key visits only form fields unless macOS "Full Keyboard Access" is turned
   * on, and Playwright's WebKit has it off with no way to set it. Tabbing to a
   * button therefore never happens there, on this or any other site, so a
   * WebKit run would assert the browser's setting rather than the app's markup.
   * Every control this file reaches carries a real role and a real handler, and
   * those are asserted in the other specs on both engines.
   */
  test.skip(({ browserName }) => browserName === 'webkit', 'WebKit Tab skips buttons by default');

  test('upload, add a custom term, process, edit a value and ask a question', async ({ page }) => {
    await signUp(page, 'kbd');
    await scriptStub(page.request, [NDA_EXTRACTION]);

    // --- upload -----------------------------------------------------------
    await gotoAfterAuth(page, '/contracts/new');

    // The contract type select is reachable and operable with the keyboard.
    await tabTo(page, focusedMatches(page, () => page.getByRole('combobox', { name: 'Contract type' })));
    await page.keyboard.press('Enter');
    await page.getByRole('option', { name: 'NDA' }).waitFor();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('combobox', { name: 'Contract type' })).toContainText('NDA');

    // The dropzone takes focus once it is unlocked (tabIndex flips from -1).
    await tabTo(page, focusedMatches(page, () => page.getByRole('button', { name: 'Upload a PDF contract' })));

    // Only the OS picker itself is stood in for.
    await page.locator('input[type="file"]').setInputFiles({
      name: 'nda.pdf',
      mimeType: 'application/pdf',
      buffer: SHORT_NDA,
    });

    // --- prepare ----------------------------------------------------------
    await page.waitForURL(/\/contracts\/[0-9a-f-]+\/prepare/, { timeout: 30_000 });
    const contractId = page.url().match(/contracts\/([0-9a-f-]+)\//)![1]!;

    await tabTo(page, focusedMatches(page, () => page.getByRole('button', { name: 'Add Key Term' })));
    await page.keyboard.press('Enter');

    // The field autofocuses, so it can be typed into straight away, and Enter
    // submits it (PrepareView's own key handler).
    await expect(page.getByLabel('Add a key term')).toBeFocused();
    await page.keyboard.type('Non-compete radius');
    await page.keyboard.press('Enter');

    const customRow = page.locator('li').filter({ hasText: 'Non-compete radius' });
    await expect(customRow.getByText('Custom')).toBeVisible();

    // --- process ----------------------------------------------------------
    await tabTo(page, focusedMatches(page, () => page.getByRole('button', { name: 'Process Contract' })));
    await page.keyboard.press('Enter');
    await page.waitForURL(`**/contracts/${contractId}`, { timeout: 60_000 });

    // --- edit a value -----------------------------------------------------
    const terms = page.getByRole('region', { name: 'Key terms' });
    await expect(terms.getByText('State of Delaware')).toBeVisible();

    await tabTo(
      page,
      focusedMatches(page, () => terms.getByRole('button', { name: 'State of Delaware' })),
      60,
    );
    await page.keyboard.press('Enter');

    const editor = page.getByLabel('Edit extracted value');
    await expect(editor).toBeFocused();
    // The editor selects its contents on focus, so typing replaces the value.
    await page.keyboard.type('State of New York');
    await page.keyboard.press('Enter');

    await expect(terms.getByText('State of New York')).toBeVisible();
    await expect(terms.getByText('Edited')).toBeVisible();

    // Escape abandons an edit rather than trapping the user in it.
    await tabTo(
      page,
      focusedMatches(page, () => terms.getByRole('button', { name: 'State of New York' })),
      60,
    );
    await page.keyboard.press('Enter');
    // Wait for focus before typing: the editor mounts and autofocuses a tick
    // after the click, and keystrokes sent before that are simply lost.
    await expect(page.getByLabel('Edit extracted value')).toBeFocused();
    await page.keyboard.type('Something else entirely');
    await page.keyboard.press('Escape');
    await expect(terms.getByText('State of New York')).toBeVisible();

    // --- chat -------------------------------------------------------------
    await scriptStub(page.request, [
      'Based on the document, the governing law is the State of Delaware. [Page 1]',
    ]);

    await tabTo(
      page,
      focusedMatches(page, () => page.getByRole('button', { name: 'Chat with Contract' })),
      60,
    );
    await page.keyboard.press('Enter');

    await tabTo(
      page,
      focusedMatches(page, () => page.getByLabel('Ask a question about this contract')),
      20,
    );
    await page.keyboard.type('What is the governing law');

    await tabTo(page, focusedMatches(page, () => page.getByRole('button', { name: 'Send question' })), 10);
    await page.keyboard.press('Enter');

    await expect(
      page.getByRole('complementary', { name: 'Chat with contract' }).getByText(/State of Delaware/),
    ).toHaveCount(1);
  });
});
