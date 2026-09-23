import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { api, createUser, destroyUser, resetOpenAiStub, scriptOpenAi, setPlan, startApp, stopApp, uploadPdf, type TestUser } from './harness';
import { SHORT_NDA } from './pdf-fixtures';

/**
 * Spec 08 §3 step 3 / spec 13 §4 — the chat bucket at its PRODUCTION limit,
 * 30 messages per hour per user: the 31st is 429 with Retry-After. (The
 * harness default raises every limit to 1000; this file sets chat back to 30.)
 */

const CHAT_LIMIT = 30;
let user: TestUser;
let contractId: string;

beforeAll(async () => {
  await startApp({ RATE_LIMIT_CHAT_PER_HOUR: String(CHAT_LIMIT) });
  user = await createUser('chat-rl');
  await setPlan(user, 'pro');
  scriptOpenAi({ content: JSON.stringify({ detected_type: 'NDA', terms: [] }) });
  const upload = await uploadPdf(user, SHORT_NDA, 'NDA');
  contractId = upload.body.contract_id;
  const processed = await api(user, `/api/contracts/${contractId}/process`, { method: 'POST' });
  expect(processed.status).toBe(200);
  resetOpenAiStub();
}, 180_000);

afterAll(async () => {
  await destroyUser(user);
  await stopApp();
}, 120_000);

describe('the chat bucket', () => {
  it(`allows ${CHAT_LIMIT} messages in an hour; the ${CHAT_LIMIT + 1}st is 429 with Retry-After`, async () => {
    // Greetings: every one is a real, counted chat turn, answered without a
    // model call, so 30 of them are quick.
    for (let i = 1; i <= CHAT_LIMIT; i += 1) {
      const res = await api(user, `/api/contracts/${contractId}/chat`, { method: 'POST', body: JSON.stringify({ message: 'thanks' }) });
      expect(res.status, `message ${i} should be allowed`).toBe(200);
    }

    const question = `the ${CHAT_LIMIT + 1}st message ${Date.now()}`;
    const blocked = await api<{ error: { code: string; retryable: boolean } }>(user, `/api/contracts/${contractId}/chat`, {
      method: 'POST',
      body: JSON.stringify({ message: question }),
    });
    expect(blocked.status).toBe(429);
    expect(blocked.body.error.code).toBe('RATE_LIMITED');
    expect(blocked.body.error.retryable).toBe(true);
    const retryAfter = Number(blocked.headers.get('retry-after'));
    expect(retryAfter).toBeGreaterThan(0);
    expect(retryAfter).toBeLessThanOrEqual(3600);

    // The limiter runs before anything is stored: the 31st question is not in the session.
    const history = await api<{ messages: Array<{ content: string }> }>(user, `/api/contracts/${contractId}/chat`);
    expect(history.body.messages.some((m) => m.content === question)).toBe(false);
    expect(history.body.messages.filter((m) => m.content === 'thanks')).toHaveLength(CHAT_LIMIT);
  }, 180_000);
});
