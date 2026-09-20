import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  api,
  createUser,
  destroyUser,
  startApp,
  stopApp,
  uploadPdf,
  type TestUser,
} from './harness';
import { CORRUPT_PDF, LONG_PDF, NOT_A_PDF, SCANNED_PDF, SHORT_NDA, makePdf } from './pdf-fixtures';

/** Spec 04 §7 — the authoritative upload gate, every rejection code exercised. */

let user: TestUser;

beforeAll(async () => {
  await startApp();
  user = await createUser('upload');
}, 180_000);

afterAll(async () => {
  await destroyUser(user);
  await stopApp();
}, 120_000);

describe('POST /api/contracts/upload — happy path', () => {
  it('returns 201 with page count, token estimate and storage flag', async () => {
    const res = await uploadPdf(user, SHORT_NDA, 'NDA');
    expect(res.status).toBe(201);
    expect(res.body.contract_id).toBeTruthy();
    expect(res.body.page_count).toBe(1);
    expect(res.body.token_estimate).toBeGreaterThan(0);
    expect(res.body.storage_available).toBe(true);
  });

  it('stores contract_text with [PAGE N] markers', async () => {
    const res = await uploadPdf(user, SHORT_NDA, 'NDA');
    const { data } = await user.client
      .from('contracts')
      .select('contract_text, status, file_path')
      .eq('id', res.body.contract_id)
      .single();

    expect(data?.contract_text).toMatch(/^\[PAGE 1\]/);
    expect(data?.status).toBe('uploaded');
    expect(data?.file_path).not.toBeNull();
  });

  it('writes upload and text_extract telemetry', async () => {
    const res = await uploadPdf(user, SHORT_NDA, 'NDA');
    const { data } = await user.client
      .from('processing_runs')
      .select('stage')
      .eq('contract_id', res.body.contract_id);

    const stages = (data ?? []).map((r) => r.stage).sort();
    expect(stages).toEqual(['text_extract', 'upload']);
  });
});

describe('POST /api/contracts/upload — every rejection code', () => {
  it('401 without a session', async () => {
    const res = await api(null, '/api/contracts/upload', { method: 'POST' });
    expect(res.status).toBe(401);
  });

  it('400 NOT_A_PDF for non-PDF bytes with a .pdf name', async () => {
    const res = await uploadPdf(user, NOT_A_PDF, 'NDA', 'disguised.pdf');
    expect(res.status).toBe(400);
    expect(res.body.error!.code).toBe('NOT_A_PDF');
  });

  it('413 FILE_TOO_LARGE above 10 MB', async () => {
    const oversize = Buffer.concat([SHORT_NDA, Buffer.alloc(11 * 1024 * 1024, 0x20)]);
    const res = await uploadPdf(user, oversize, 'NDA');
    expect(res.status).toBe(413);
    const body = res.body;
    expect(body.error!.code).toBe('FILE_TOO_LARGE');
    expect(body.error!.message).toMatch(/the limit is 10 MB/);
  });

  it('422 TOO_MANY_PAGES above 20 pages', async () => {
    const res = await uploadPdf(user, LONG_PDF, 'NDA');
    expect(res.status).toBe(422);
    const body = res.body;
    expect(body.error!.code).toBe('TOO_MANY_PAGES');
    expect(body.error!.message).toMatch(/the limit is 20 pages for now/);
  });

  it('422 SCANNED_PDF below the word floor', async () => {
    const res = await uploadPdf(user, SCANNED_PDF, 'NDA');
    expect(res.status).toBe(422);
    expect(res.body.error!.code).toBe('SCANNED_PDF');
  });

  it('422 CORRUPT_PDF for a truncated file', async () => {
    const res = await uploadPdf(user, CORRUPT_PDF, 'NDA');
    expect(res.status).toBe(422);
    expect(res.body.error!.code).toBe('CORRUPT_PDF');
  });

  it('400 VALIDATION for an unknown contract_type', async () => {
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(SHORT_NDA)], { type: 'application/pdf' }), 'x.pdf');
    form.append('contract_type', 'SOW');
    const res = await fetch('http://127.0.0.1:3100/api/contracts/upload', {
      method: 'POST',
      headers: { Cookie: user.cookie },
      body: form,
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error!.code).toBe('VALIDATION');
    expect(body.error.fields.contract_type).toBeTruthy();
  });
});

describe('a rejected upload stores nothing and charges nothing', () => {
  it('CORRUPT_PDF leaves no contract row and does not move the quota counter', async () => {
    const { data: before } = await user.client
      .from('profiles')
      .select('analyses_used')
      .eq('id', user.id)
      .single();
    const { count: rowsBefore } = await user.client
      .from('contracts')
      .select('id', { count: 'exact', head: true });

    const res = await uploadPdf(user, CORRUPT_PDF, 'NDA');
    expect(res.status).toBe(422);

    const { data: after } = await user.client
      .from('profiles')
      .select('analyses_used')
      .eq('id', user.id)
      .single();
    const { count: rowsAfter } = await user.client
      .from('contracts')
      .select('id', { count: 'exact', head: true });

    expect(after?.analyses_used).toBe(before?.analyses_used);
    expect(rowsAfter).toBe(rowsBefore);
  });
});

describe('quota is consumed at upload and is deletion-proof', () => {
  it('deleting a contract does not restore the unit', async () => {
    const fresh = await createUser('quota');
    try {
      const first = await uploadPdf(fresh, SHORT_NDA, 'NDA');
      expect(first.status).toBe(201);

      const { data: afterUpload } = await fresh.client
        .from('profiles')
        .select('analyses_used')
        .eq('id', fresh.id)
        .single();
      expect(afterUpload?.analyses_used).toBe(1);

      const del = await api(fresh, `/api/contracts/${first.body.contract_id}`, { method: 'DELETE' });
      expect(del.status).toBe(204);

      const { data: afterDelete } = await fresh.client
        .from('profiles')
        .select('analyses_used')
        .eq('id', fresh.id)
        .single();
      // The decisive case: the counter is monotonic within the period.
      expect(afterDelete?.analyses_used).toBe(1);
    } finally {
      await destroyUser(fresh);
    }
  }, 120_000);

  it('blocks the 6th analysis on a free trial with the plan message', async () => {
    const fresh = await createUser('quotacap');
    try {
      for (let i = 0; i < 5; i += 1) {
        const res = await uploadPdf(fresh, SHORT_NDA, 'NDA');
        expect(res.status, `upload ${i + 1} should succeed`).toBe(201);
      }

      const sixth = await uploadPdf(fresh, SHORT_NDA, 'NDA');
      expect(sixth.status).toBe(402);
      const body = sixth.body;
      expect(body.error!.code).toBe('QUOTA_EXCEEDED');
      expect(body.error!.message).toMatch(/all 5 analyses on your Free Trial plan/);
    } finally {
      await destroyUser(fresh);
    }
  }, 180_000);

  it('an expired trial is blocked at the first analysis with distinct copy', async () => {
    const fresh = await createUser('expired');
    try {
      const { admin } = await import('./harness');
      await admin()
        .from('profiles')
        .update({ trial_ends_at: new Date(Date.now() - 86_400_000).toISOString() })
        .eq('id', fresh.id);

      const res = await uploadPdf(fresh, SHORT_NDA, 'NDA');
      expect(res.status).toBe(402);
      const body = res.body;
      expect(body.error!.message).toMatch(/free trial has ended/);

      // The plan value itself is never mutated by code.
      const { data } = await admin().from('profiles').select('plan').eq('id', fresh.id).single();
      expect(data?.plan).toBe('free_trial');
    } finally {
      await destroyUser(fresh);
    }
  }, 120_000);
});

describe('page and token gates are independent, in order', () => {
  it('a 21-page document fails on pages, not tokens', async () => {
    const pdf = makePdf(
      Array.from({ length: 1000 }, (_, i) => `Line ${i} of the agreement.`).join('\n'),
    );
    const res = await uploadPdf(user, pdf, 'MSA');
    expect(res.status).toBe(422);
    expect(res.body.error!.code).toBe('TOO_MANY_PAGES');
  });
});
