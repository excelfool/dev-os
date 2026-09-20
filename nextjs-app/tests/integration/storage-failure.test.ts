import { afterAll, beforeAll, afterEach, describe, expect, it } from 'vitest';
import {
  admin,
  api,
  createUser,
  destroyUser,
  failStorageWrites,
  setPlan,
  startApp,
  stopApp,
  uploadPdf,
  type TestUser,
} from './harness';
import { SHORT_NDA } from './pdf-fixtures';

/**
 * Spec 04 §2 step 9 and spec 07 §2 — the degraded Storage path.
 *
 * "A Storage failure never fails this request" is a specified behaviour, not an
 * accident, and it had never been exercised: the product has no way to make
 * Storage fail on demand. The app runs against a transparent Supabase proxy
 * here, so auth, RLS and the database stay real while Storage writes 500.
 */

let user: TestUser;

beforeAll(async () => {
  await startApp({}, { proxySupabase: true });
  user = await createUser('storagefail');
  await setPlan(user, 'pro');
}, 180_000);

afterEach(() => {
  failStorageWrites(null);
});

afterAll(async () => {
  await destroyUser(user);
  await stopApp();
}, 120_000);

describe('upload with Storage unavailable', () => {
  it('still returns 201, with storage_available false and file_path NULL', async () => {
    failStorageWrites(/^\/storage\/v1\/object\//);

    const res = await uploadPdf(user, SHORT_NDA, 'NDA');

    // The request succeeds. The AI pipeline never depends on Storage.
    expect(res.status).toBe(201);
    expect(res.body.storage_available).toBe(false);
    expect(res.body.contract_id).toBeTruthy();

    const { data } = await admin()
      .from('contracts')
      .select('file_path, status, contract_text')
      .eq('id', res.body.contract_id)
      .single();

    expect(data?.file_path).toBeNull();
    expect(data?.status).toBe('uploaded');
    // contract_text is the single source of truth and is unaffected.
    expect(data?.contract_text).toMatch(/^\[PAGE 1\]/);
  }, 90_000);

  it('consumes exactly one quota unit — the contract exists, so it is charged', async () => {
    const fresh = await createUser('storagequota');
    try {
      failStorageWrites(/^\/storage\/v1\/object\//);

      const res = await uploadPdf(fresh, SHORT_NDA, 'NDA');
      expect(res.status).toBe(201);

      const { data } = await admin()
        .from('profiles')
        .select('analyses_used')
        .eq('id', fresh.id)
        .single();
      // Not refunded: the refund path is for failures that leave no contract.
      expect(data?.analyses_used).toBe(1);
    } finally {
      await destroyUser(fresh);
    }
  }, 120_000);

  it('the contract remains fully processable without its PDF', async () => {
    failStorageWrites(/^\/storage\/v1\/object\//);
    const upload = await uploadPdf(user, SHORT_NDA, 'NDA');
    expect(upload.body.storage_available).toBe(false);
    failStorageWrites(null);

    const { scriptOpenAi } = await import('./harness');
    scriptOpenAi({
      content: JSON.stringify({
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
      }),
    });

    const processed = await api<{ status: string; term_count: number }>(
      user,
      `/api/contracts/${upload.body.contract_id}/process`,
      { method: 'POST' },
    );

    expect(processed.status).toBe(200);
    expect(processed.body.status).toBe('completed');
    expect(processed.body.term_count).toBe(10);
  }, 120_000);

  it('signed-url returns NO_FILE so the client falls back to the text viewer', async () => {
    failStorageWrites(/^\/storage\/v1\/object\//);
    const upload = await uploadPdf(user, SHORT_NDA, 'NDA');
    failStorageWrites(null);

    const res = await api<{ error: { code: string; message: string } }>(
      user,
      `/api/contracts/${upload.body.contract_id}/signed-url`,
      { method: 'POST' },
    );

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NO_FILE');
  }, 90_000);

  it('a later upload succeeds normally once Storage recovers', async () => {
    failStorageWrites(/^\/storage\/v1\/object\//);
    const degraded = await uploadPdf(user, SHORT_NDA, 'NDA');
    expect(degraded.body.storage_available).toBe(false);

    failStorageWrites(null);
    const healthy = await uploadPdf(user, SHORT_NDA, 'NDA');
    expect(healthy.status).toBe(201);
    expect(healthy.body.storage_available).toBe(true);
  }, 120_000);
});

describe('deleting a contract whose Storage object is unreachable', () => {
  it('still deletes the row — a Storage failure must not block the DB delete', async () => {
    const upload = await uploadPdf(user, SHORT_NDA, 'NDA');
    expect(upload.body.storage_available).toBe(true);

    failStorageWrites(/^\/storage\/v1\/object\//);

    const res = await api(user, `/api/contracts/${upload.body.contract_id}`, { method: 'DELETE' });
    expect(res.status).toBe(204);

    const { count } = await admin()
      .from('contracts')
      .select('id', { count: 'exact', head: true })
      .eq('id', upload.body.contract_id);
    expect(count).toBe(0);
  }, 120_000);
});
