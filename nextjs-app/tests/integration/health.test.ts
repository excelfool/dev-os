import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BASE_URL, startApp, stopApp } from './harness';

/**
 * Spec 14 §1 — /api/health is public, reports the deployed commit and the DB
 * probe. Named in spec 14 §7 but never written; added when the live site was
 * found reporting commit:"dev", because Netlify exposes the commit as
 * COMMIT_REF and the route only read COMMIT_SHA.
 */

beforeAll(async () => {
  await startApp({ COMMIT_REF: 'abc1234deadbeef' });
}, 180_000);

afterAll(async () => {
  await stopApp();
}, 120_000);

describe('GET /api/health', () => {
  it('is reachable without a session and reports db: ok', async () => {
    const res = await fetch(`${BASE_URL}/api/health`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('ok');
    expect(body.db).toBe('ok');
  });

  it("reports Netlify's COMMIT_REF as the commit, not 'dev'", async () => {
    const body = await (await fetch(`${BASE_URL}/api/health`)).json();
    expect(body.commit).toBe('abc1234deadbeef');
  });
});
