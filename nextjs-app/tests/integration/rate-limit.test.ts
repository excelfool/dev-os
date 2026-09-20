import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  api,
  createUser,
  destroyUser,
  scriptOpenAi,
  setPlan,
  startApp,
  stopApp,
  uploadPdf,
  type TestUser,
} from './harness';
import { SHORT_NDA } from './pdf-fixtures';

/**
 * Spec 13 §10 — the rate limiter. This file starts the app with SMALL limits so
 * the boundary can be crossed in a few requests instead of twenty; the
 * production values live in .env.example and are the same code path.
 */

const UPLOAD_LIMIT = 3;
const PROCESS_LIMIT = 2;

let user: TestUser;

beforeAll(async () => {
  await startApp({
    RATE_LIMIT_UPLOAD_PER_HOUR: String(UPLOAD_LIMIT),
    RATE_LIMIT_PROCESS_PER_HOUR: String(PROCESS_LIMIT),
    RATE_LIMIT_CHAT_PER_HOUR: '2',
  });
  user = await createUser('ratelimit');
  await setPlan(user, 'pro');
  scriptOpenAi({ content: JSON.stringify({ detected_type: 'NDA', terms: [] }) });
}, 180_000);

afterAll(async () => {
  await destroyUser(user);
  await stopApp();
}, 120_000);

describe('the upload bucket', () => {
  it(`allows ${UPLOAD_LIMIT} requests then returns 429 with Retry-After`, async () => {
    for (let i = 1; i <= UPLOAD_LIMIT; i += 1) {
      const res = await uploadPdf(user, SHORT_NDA, 'NDA');
      expect(res.status, `request ${i} should be allowed`).toBe(201);
    }

    const blocked = await uploadPdf(user, SHORT_NDA, 'NDA');
    expect(blocked.status).toBe(429);

    const body = blocked.body;
    expect(body.error!.code).toBe('RATE_LIMITED');
    expect(body.error!.retryable).toBe(true);
    expect(body.error!.message).toMatch(/try again in \d+ minutes/i);

    const retryAfter = Number(blocked.headers.get('retry-after'));
    expect(retryAfter).toBeGreaterThan(0);
    // The window is the truncated hour, so it can never exceed 3600s.
    expect(retryAfter).toBeLessThanOrEqual(3600);
  }, 120_000);

  it('counts a rejected request too — the limiter runs before validation', async () => {
    const fresh = await createUser('ratelimit2');
    try {
      await setPlan(fresh, 'pro');
      // Deliberately invalid: the limiter sits at step 2, before the schema and
      // file checks at steps 4-7.
      for (let i = 0; i < UPLOAD_LIMIT; i += 1) {
        await uploadPdf(fresh, Buffer.from('not a pdf'), 'NDA');
      }
      const blocked = await uploadPdf(fresh, SHORT_NDA, 'NDA');
      expect(blocked.status).toBe(429);
    } finally {
      await destroyUser(fresh);
    }
  }, 120_000);
});

describe('the process bucket is counted separately', () => {
  it(`allows ${PROCESS_LIMIT} process calls independently of the upload count`, async () => {
    const fresh = await createUser('ratelimit3');
    try {
      await setPlan(fresh, 'pro');

      const ids: string[] = [];
      for (let i = 0; i < UPLOAD_LIMIT; i += 1) {
        const res = await uploadPdf(fresh, SHORT_NDA, 'NDA');
        expect(res.status).toBe(201);
        ids.push(res.body.contract_id);
      }

      for (let i = 0; i < PROCESS_LIMIT; i += 1) {
        const res = await api(fresh, `/api/contracts/${ids[i]}/process`, { method: 'POST' });
        expect(res.status, `process ${i + 1} should be allowed`).toBe(200);
      }

      const blocked = await api<{ error: { code: string } }>(
        fresh,
        `/api/contracts/${ids[PROCESS_LIMIT]}/process`,
        { method: 'POST' },
      );
      expect(blocked.status).toBe(429);
      expect(blocked.body.error.code).toBe('RATE_LIMITED');
    } finally {
      await destroyUser(fresh);
    }
  }, 180_000);
});

describe('counters are per user', () => {
  it("one user's exhausted bucket does not block another", async () => {
    const other = await createUser('ratelimit4');
    try {
      await setPlan(other, 'pro');
      // `user` is already over its upload limit from the first test.
      const res = await uploadPdf(other, SHORT_NDA, 'NDA');
      expect(res.status).toBe(201);
    } finally {
      await destroyUser(other);
    }
  }, 120_000);
});
