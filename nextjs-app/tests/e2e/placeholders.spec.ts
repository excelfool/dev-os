import { test, expect } from '@playwright/test';
import { SHORT_NDA } from '../integration/pdf-fixtures';
import { ask, chat, openChat, processedContract, scriptStub } from './helpers';

/**
 * Spec 20 §4.2 / §5.1, spec 08 v1.1 §C (P-6) — the escalation offer while
 * `risk.escalate` is a stub: after three unresolved turns a muted note under
 * the last assistant bubble, informational only, and no button to press.
 */

const REFUSAL = 'I cannot find this in the document.';
const STUB_NOTE = 'A human reviewer hand-off arrives in Phase 1.';

test('after three unresolved turns the stub note shows and no hand-off button exists', async ({ page }) => {
  const contractId = await processedContract(page, SHORT_NDA);
  await openChat(page, contractId);
  await scriptStub(page.request, [REFUSAL]);

  const questions = ['Is there a non-compete clause?', 'Is there a liability cap?', 'Is there an audit clause?'];
  for (const [turn, question] of questions.entries()) {
    await ask(page, question);
    await expect(chat(page).getByText(REFUSAL)).toHaveCount(turn + 1);
    // Not before the third unresolved turn.
    if (turn < 2) await expect(chat(page).getByText(STUB_NOTE)).toHaveCount(0);
  }

  await expect(chat(page).getByText(STUB_NOTE)).toBeVisible();
  // Stub: informational only — nothing to click, and no `/human` affordance.
  await expect(chat(page).getByRole('button', { name: /human|reviewer|escalat/i })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /ask a human reviewer/i })).toHaveCount(0);

  // The note sits under the LAST assistant bubble, after the third refusal.
  const lastRefusal = chat(page).getByText(REFUSAL).last();
  const note = chat(page).getByText(STUB_NOTE);
  const [refusalBox, noteBox] = await Promise.all([lastRefusal.boundingBox(), note.boundingBox()]);
  expect(noteBox!.y).toBeGreaterThan(refusalBox!.y);
});
