import { test, expect } from '@playwright/test';
import { SHORT_NDA } from '../integration/pdf-fixtures';
import {
  ask,
  chat,
  gotoAfterAuth,
  openChat,
  processedContract,
  scriptStub,
  stubRequests,
  systemBlocks,
} from './helpers';

/**
 * Spec 08 §8, US-012 — conversational memory through the real UI.
 *
 * Lab 2 Lesson 2's four-turn memory test failed live on both classification
 * turns while `tests/unit/chat-logic.test.ts` was green, because those tests
 * call `classifyQuery` directly and never reach the prompt the model is
 * actually sent. Two separate causes produced one symptom:
 *
 *   T2 "What does that mean in practice?"  classified `history` correctly, but
 *      the history prompt was BASE + suffix, and BASE orders the model to
 *      answer only from the document and otherwise reply with the exact
 *      refusal — while class `history` omits the document. Refusal was the
 *      only instruction left to follow.
 *   T4 "What have I asked you so far"      never classified `history` at all:
 *      the history regex was written only in the second person.
 *
 * L17 (2026-09-23): T2 now routes to `both`, not `history`. A bare pronoun
 * continues the conversation but its referent is a clause, and a `history`
 * turn with no document answered from general knowledge while citing a page
 * it never read. `both` carries the document AND permission to use the
 * conversation, so the follow-up is still never forced into the refusal.
 *
 * These tests assert on what the app SENDS to the model, because that is where
 * both bugs lived. A stub cannot judge a model's answer, but it records the
 * prompt exactly.
 */

const REFUSAL = 'I cannot find this in the document.';
const GROUNDED_ANSWER =
  'Based on the document, the governing law is the State of Delaware. [Page 1]';

test.describe('conversational memory — the two turns that failed live', () => {
  test('a demonstrative follow-up gets the document and the conversation, and is never forced to refuse', async ({
    page,
  }) => {
    const contractId = await processedContract(page, SHORT_NDA);
    await openChat(page, contractId);

    // T1 — a grounded contract question.
    await scriptStub(page.request, [GROUNDED_ANSWER]);
    await ask(page, 'What is the governing law');
    await expect(chat(page).getByText(/State of Delaware/)).toHaveCount(1);
    await expect(chat(page).getByRole('button', { name: 'Page 1' })).toBeVisible();

    // T2 — the follow-up. Its subject is only recoverable from T1.
    await scriptStub(page.request, [
      'Based on the document, disputes are decided under Delaware law. [Page 1]',
    ]);
    await ask(page, 'What does that mean in practice?');
    await expect(chat(page).getByText(/decided under Delaware law/)).toHaveCount(1);

    const sent = systemBlocks((await stubRequests(page.request))[0]!).join(' ');

    // L17: class `both` — the document is in the prompt, so a page it cites was read.
    expect(sent).toContain("user's uploaded contract");
    // The original bug stays fixed: the prompt lets the model answer from the
    // conversation and reserves the refusal for the contract part only.
    expect(sent).toContain('Part of this question is about your earlier conversation');
    expect(sent).toContain(`only when the question asks about the contract and the document does not answer it`);
    expect(sent).not.toContain('This question is about your earlier conversation with the user, not about the contract text');

    // A grounded, cited answer needs no repair call.
    expect(await stubRequests(page.request)).toHaveLength(1);
  });

  test('"What have I asked you so far" is answered from the conversation, not the document', async ({
    page,
  }) => {
    const contractId = await processedContract(page, SHORT_NDA);
    await openChat(page, contractId);

    await scriptStub(page.request, [GROUNDED_ANSWER]);
    await ask(page, 'What is the governing law');
    await expect(chat(page).getByText(/State of Delaware/)).toHaveCount(1);

    // T3 — a hard refresh, to prove the turn below runs against reloaded
    // history rather than in-memory state.
    await page.reload();
    await page.getByRole('button', { name: 'Chat with Contract' }).click();
    await expect(chat(page).getByText('What is the governing law')).toHaveCount(1);
    await expect(chat(page).getByText(/State of Delaware/)).toHaveCount(1);

    // T4 — the lesson's own HISTORY example. It contains no contract noun, so
    // there is nothing here for the contract path to find.
    await scriptStub(page.request, ['So far you have asked about the governing law.']);
    await ask(page, 'What have I asked you so far');
    await expect(chat(page).getByText('So far you have asked about the governing law.')).toHaveCount(1);
    await expect(chat(page).getByText(REFUSAL)).toHaveCount(0);

    const requests = await stubRequests(page.request);
    const sent = systemBlocks(requests[0]!).join(' ');

    expect(sent).not.toContain(REFUSAL);
    expect(sent).toContain('earlier conversation');
    expect(sent).not.toContain("user's uploaded contract");

    // The earlier turns must be in context — that is what makes the answer
    // possible at all.
    const userTurns = requests[0]!.messages.filter((m) => m.role === 'user');
    expect(userTurns.map((m) => m.content)).toContain('What is the governing law');

    // No wasted repair call on an answer that has no page to cite.
    expect(requests).toHaveLength(1);
  });

  test('a contract question still gets the document and keeps the refusal available', async ({
    page,
  }) => {
    const contractId = await processedContract(page, SHORT_NDA);
    await openChat(page, contractId);

    await scriptStub(page.request, [GROUNDED_ANSWER]);
    await ask(page, 'What is the governing law');
    await expect(chat(page).getByText(/State of Delaware/)).toHaveCount(1);

    const sent = systemBlocks((await stubRequests(page.request))[0]!).join(' ');
    expect(sent).toContain('Answer only from the document text provided');
    expect(sent).toContain(REFUSAL);
    expect(sent).toContain("user's uploaded contract");
  });
});
