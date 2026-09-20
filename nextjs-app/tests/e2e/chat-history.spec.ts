import { test, expect, type Page, type APIRequestContext } from '@playwright/test';
import { SHORT_NDA } from '../integration/pdf-fixtures';

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
 * These tests assert on what the app SENDS to the model, because that is where
 * both bugs lived. A stub cannot judge a model's answer, but it records the
 * prompt exactly.
 */

const STUB = 'http://127.0.0.1:3300';
const REFUSAL = 'I cannot find this in the document.';
const GROUNDED_ANSWER = 'Based on the document, the governing law is the State of Delaware. [Page 1]';

const EXTRACTION = JSON.stringify({
  detected_type: 'NDA',
  terms: [
    {
      term_name: 'Governing Law',
      value: 'Delaware',
      page_number: 1,
      confidence_score: 0.95,
      source_sentence: 'This Agreement is governed by the laws of the State of Delaware.',
    },
  ],
});

interface LlmRequest {
  messages: Array<{ role: string; content: string }>;
}

async function scriptStub(request: APIRequestContext, contents: string[]): Promise<void> {
  await request.post(`${STUB}/__control/reset`);
  await request.post(`${STUB}/__control/script`, {
    data: { responses: contents.map((content) => ({ content })) },
  });
}

async function stubRequests(request: APIRequestContext): Promise<LlmRequest[]> {
  const res = await request.get(`${STUB}/__control/requests`);
  return (await res.json()) as LlmRequest[];
}

function systemBlocks(req: LlmRequest): string[] {
  return req.messages.filter((m) => m.role === 'system').map((m) => m.content);
}

function uniqueEmail(label: string): string {
  return `e2e.${label}.${Date.now()}${Math.floor(Math.random() * 1000)}@gmail.com`;
}

/**
 * The results page shows each term's source sentence and its own "Source:
 * Page N" button, so chat assertions must be scoped to the panel or they match
 * the terms panel instead.
 */
function chat(page: Page) {
  return page.getByRole('complementary', { name: 'Chat with contract' });
}

/** Signs up through the UI, then uploads and processes over the authed session. */
async function processedContract(page: Page): Promise<string> {
  const email = uniqueEmail('chat');
  await page.goto('/signup');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill('Password12345');
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.waitForURL('**/dashboard', { timeout: 20_000 });

  // page.request shares the browser's cookies, so these run as the signed-in
  // user without re-implementing auth.
  await scriptStub(page.request, [EXTRACTION]);

  const upload = await page.request.post('/api/contracts/upload', {
    multipart: {
      contract_type: 'NDA',
      file: { name: 'nda.pdf', mimeType: 'application/pdf', buffer: SHORT_NDA },
    },
  });
  expect(upload.status()).toBe(201);
  const contractId = (await upload.json()).contract_id as string;

  const processed = await page.request.post(`/api/contracts/${contractId}/process`);
  expect(processed.status()).toBe(200);

  return contractId;
}

async function openChat(page: Page, contractId: string): Promise<void> {
  await page.goto(`/contracts/${contractId}`);
  await page.getByRole('button', { name: 'Chat with Contract' }).click();
}

async function ask(page: Page, question: string): Promise<void> {
  await page.getByLabel('Ask a question about this contract').fill(question);
  await page.getByRole('button', { name: 'Send question' }).click();
}

/**
 * KNOWN, SEPARATE BUG — not what these tests cover.
 *
 * The assistant's answer sometimes renders TWICE for a single turn: measured at
 * 2 runs in 5, with exactly one POST, one model call and exactly two rows in
 * the database. The duplicate is render-only; the data is correct.
 *
 * `useChat` starts a history GET on mount and does not discard its result once
 * a turn has begun, so a load that lands mid-turn can leave the assistant in
 * the list that the POST's own functional append then adds again. React
 * StrictMode's double mount makes it visible in dev (two GETs per mount). Two
 * attempts to force that interleaving deterministically from Playwright did not
 * reproduce it, so no regression test is claimed for it here.
 *
 * Assertions below therefore use `.first()` where a duplicate would otherwise
 * trip strict mode. What these tests actually verify — the class, the prompt
 * and the absence of a repair call — is unaffected by it.
 */

test.describe('conversational memory — the two turns that failed live', () => {
  test('a demonstrative follow-up is never told to answer only from the document', async ({
    page,
  }) => {
    const contractId = await processedContract(page);
    await openChat(page, contractId);

    // T1 — a grounded contract question.
    await scriptStub(page.request, [GROUNDED_ANSWER]);
    await ask(page, 'What is the governing law');
    await expect(chat(page).getByText(/State of Delaware/).first()).toBeVisible();
    await expect(chat(page).getByRole('button', { name: 'Page 1' }).first()).toBeVisible();

    // T2 — the follow-up. Its subject is only recoverable from T1.
    await scriptStub(page.request, [
      'You asked about the governing law, which means Delaware law applies to disputes.',
    ]);
    await ask(page, 'What does that mean in practice?');
    await expect(chat(page).getByText(/Delaware law applies to disputes/).first()).toBeVisible();

    const sent = systemBlocks((await stubRequests(page.request))[0]!).join(' ');

    // The bug: the refusal instruction reached a turn with no document.
    expect(sent).not.toContain(REFUSAL);
    expect(sent).not.toContain('Answer only from the document text provided');
    expect(sent).toContain('earlier conversation');
    // Class `history` omits the document body (spec 08 §4).
    expect(sent).not.toContain("user's uploaded contract");

    // And the answer must not be forced through a repair call it cannot satisfy.
    expect(await stubRequests(page.request)).toHaveLength(1);
  });

  test('"What have I asked you so far" is answered from the conversation, not the document', async ({
    page,
  }) => {
    const contractId = await processedContract(page);
    await openChat(page, contractId);

    await scriptStub(page.request, [GROUNDED_ANSWER]);
    await ask(page, 'What is the governing law');
    await expect(chat(page).getByText(/State of Delaware/).first()).toBeVisible();

    // T3 — a hard refresh, to prove the turn below runs against reloaded
    // history rather than in-memory state.
    await page.reload();
    await page.getByRole('button', { name: 'Chat with Contract' }).click();
    await expect(chat(page).getByText('What is the governing law').first()).toBeVisible();
    await expect(chat(page).getByText(/State of Delaware/).first()).toBeVisible();

    // T4 — the lesson's own HISTORY example. It contains no contract noun, so
    // there is nothing here for the contract path to find.
    await scriptStub(page.request, ['So far you have asked about the governing law.']);
    await ask(page, 'What have I asked you so far');
    await expect(chat(page).getByText('So far you have asked about the governing law.').first()).toBeVisible();
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
    const contractId = await processedContract(page);
    await openChat(page, contractId);

    await scriptStub(page.request, [GROUNDED_ANSWER]);
    await ask(page, 'What is the governing law');
    await expect(chat(page).getByText(/State of Delaware/).first()).toBeVisible();

    const sent = systemBlocks((await stubRequests(page.request))[0]!).join(' ');
    expect(sent).toContain('Answer only from the document text provided');
    expect(sent).toContain(REFUSAL);
    expect(sent).toContain("user's uploaded contract");
  });
});
