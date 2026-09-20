import { expect, type APIRequestContext, type Page } from '@playwright/test';

/**
 * Shared E2E setup. The OpenAI stub runs as its own Playwright `webServer` on
 * 3300 (see playwright.config.ts) and the app is started with OPENAI_BASE_URL
 * pointed at it, so no spec bills a real call.
 */

export const STUB = 'http://127.0.0.1:3300';

export const NDA_EXTRACTION = JSON.stringify({
  detected_type: 'NDA',
  terms: [
    {
      term_name: 'Governing Law',
      value: 'State of Delaware',
      page_number: 1,
      confidence_score: 0.95,
      source_sentence: 'This Agreement is governed by the laws of the State of Delaware.',
    },
    {
      // The library name is 'Term & Duration'; post-processing drops anything
      // that is neither a library term for this contract type nor a custom one.
      term_name: 'Term & Duration',
      value: 'Two years from the Effective Date',
      page_number: 1,
      confidence_score: 0.88,
      source_sentence:
        'This Agreement runs for two (2) years from the Effective Date, and the confidentiality obligations survive for a further three (3) years after termination.',
    },
  ],
});

export interface LlmRequest {
  messages: Array<{ role: string; content: string }>;
}

export async function scriptStub(request: APIRequestContext, contents: string[]): Promise<void> {
  await request.post(`${STUB}/__control/reset`);
  await request.post(`${STUB}/__control/script`, {
    data: { responses: contents.map((content) => ({ content })) },
  });
}

export async function stubRequests(request: APIRequestContext): Promise<LlmRequest[]> {
  const res = await request.get(`${STUB}/__control/requests`);
  return (await res.json()) as LlmRequest[];
}

export function systemBlocks(req: LlmRequest): string[] {
  return req.messages.filter((m) => m.role === 'system').map((m) => m.content);
}

export function uniqueEmail(label: string): string {
  return `e2e.${label}.${Date.now()}${Math.floor(Math.random() * 1000)}@gmail.com`;
}

/** Signs up through the real form, landing on the dashboard. */
export async function signUp(page: Page, label: string): Promise<string> {
  const email = uniqueEmail(label);
  await page.goto('/signup');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill('Password12345');
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.waitForURL('**/dashboard', { timeout: 20_000 });
  // WebKit reports the URL change before the dashboard has settled, and a
  // second navigation to /dashboard then interrupts an immediate goto(). Wait
  // for content a fresh account is guaranteed to render.
  await page.getByText('No contracts reviewed yet').waitFor({ timeout: 20_000 });
  return email;
}

/**
 * Uploads over the signed-in session rather than the wizard. Used by specs
 * whose subject is a later screen; `contract-review.spec.ts` drives the wizard
 * itself, because that is the flow it is there to prove.
 */
export async function uploadViaApi(
  page: Page,
  buffer: Buffer,
  contractType: 'NDA' | 'MSA' = 'NDA',
): Promise<string> {
  const upload = await page.request.post('/api/contracts/upload', {
    multipart: {
      contract_type: contractType,
      file: { name: 'contract.pdf', mimeType: 'application/pdf', buffer },
    },
  });
  expect(upload.status()).toBe(201);
  return (await upload.json()).contract_id as string;
}

/** A signed-up user with one uploaded, processed contract. */
export async function processedContract(
  page: Page,
  buffer: Buffer,
  extraction: string = NDA_EXTRACTION,
  contractType: 'NDA' | 'MSA' = 'NDA',
): Promise<string> {
  await signUp(page, 'flow');
  await scriptStub(page.request, [extraction]);
  const contractId = await uploadViaApi(page, buffer, contractType);
  const processed = await page.request.post(`/api/contracts/${contractId}/process`);
  expect(processed.status()).toBe(200);
  return contractId;
}

/** The chat panel, scoped — the results page also shows source sentences. */
export function chat(page: Page) {
  return page.getByRole('complementary', { name: 'Chat with contract' });
}

export async function openChat(page: Page, contractId: string): Promise<void> {
  await gotoAfterAuth(page, `/contracts/${contractId}`);
  await page.getByRole('button', { name: 'Chat with Contract' }).click();
}

export async function ask(page: Page, question: string): Promise<void> {
  await page.getByLabel('Ask a question about this contract').fill(question);
  await page.getByRole('button', { name: 'Send question' }).click();
}

/**
 * Forces the text viewer by answering the signed-url call with the same
 * `404 NO_FILE` the server returns when a contract has no stored PDF — a purge,
 * or a Storage write that failed at upload. This drives the app's real fallback
 * branch. The server-side half of that path (upload recording
 * `storage_available: false`) is covered by the integration suite's Supabase
 * proxy, which cannot be reached from a browser-driven server.
 */
export async function forceTextViewer(page: Page, contractId: string): Promise<void> {
  await page.route(`**/api/contracts/${contractId}/signed-url`, (route) =>
    route.fulfill({
      status: 404,
      contentType: 'application/json',
      body: JSON.stringify({ error: { code: 'NO_FILE', message: 'No file.' } }),
    }),
  );
}

/**
 * `AuthForm` does `router.replace('/dashboard')` then `router.refresh()`. The
 * refresh starts a second navigation to /dashboard that can land after the page
 * has rendered, and in WebKit it cancels a goto() issued in between with
 * "interrupted by another navigation". Waiting on load state or on dashboard
 * content does not close the window, because the refresh may not have started
 * yet. One retry does, and keeps the failure visible if it is anything else.
 */
export async function gotoAfterAuth(page: Page, path: string): Promise<void> {
  try {
    await page.goto(path);
  } catch (error) {
    if (!(error instanceof Error) || !/interrupted by another navigation/.test(error.message)) {
      throw error;
    }
    await page.goto(path);
  }
}
