import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  admin,
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

/** Specs 07, 09, 10, 11, 14 — the CRUD, feedback and lifecycle routes. */

let user: TestUser;

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

/** Owns its own contract: persist_key_terms replaces rather than merges. */
async function processedContract(owner: TestUser = user): Promise<string> {
  scriptOpenAi({ content: EXTRACTION });
  const upload = await uploadPdf(owner, SHORT_NDA, 'NDA');
  expect(upload.status).toBe(201);
  const res = await api(owner, `/api/contracts/${upload.body.contract_id}/process`, {
    method: 'POST',
  });
  expect(res.status).toBe(200);
  return upload.body.contract_id;
}

beforeAll(async () => {
  await startApp();
  user = await createUser('lifecycle');
  await setPlan(user, 'pro');
}, 180_000);

afterAll(async () => {
  await destroyUser(user);
  await stopApp();
}, 120_000);

describe('GET /api/health — public', () => {
  it('answers 200 without a session and is not redirected', async () => {
    const res = await api<{ status: string; db: string; commit: string }>(null, '/api/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.db).toBe('ok');
    expect(res.headers.get('cache-control')).toMatch(/no-store/);
  });
});

describe('GET /api/system-status — authenticated only', () => {
  it('401 anonymously, despite bypassing the middleware matcher', async () => {
    const res = await api<{ error: { code: string } }>(null, '/api/system-status');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('200 with a session', async () => {
    const res = await api<{ level: string }>(user, '/api/system-status');
    expect(res.status).toBe(200);
    expect(['none', 'p1', 'p0']).toContain(res.body.level);
  });
});

describe('GET /api/contracts', () => {
  it('sorts, filters and pages, with an unfiltered summary', async () => {
    const lister = await createUser('lister');
    try {
      await setPlan(lister, 'pro');
      await uploadPdf(lister, SHORT_NDA, 'NDA', 'alpha.pdf');
      await uploadPdf(lister, SHORT_NDA, 'MSA', 'bravo.pdf');
      await uploadPdf(lister, SHORT_NDA, 'NDA', 'charlie.pdf');

      const byName = await api<{ contracts: Array<{ file_name: string }> }>(
        lister,
        '/api/contracts?sort=file_name&order=asc',
      );
      expect(byName.body.contracts.map((c) => c.file_name)).toEqual([
        'alpha.pdf',
        'bravo.pdf',
        'charlie.pdf',
      ]);

      const desc = await api<{ contracts: Array<{ file_name: string }> }>(
        lister,
        '/api/contracts?sort=file_name&order=desc',
      );
      expect(desc.body.contracts.map((c) => c.file_name)).toEqual([
        'charlie.pdf',
        'bravo.pdf',
        'alpha.pdf',
      ]);

      const filtered = await api<{
        contracts: Array<{ contract_type: string }>;
        summary: { total: number; nda: number; msa: number };
      }>(lister, '/api/contracts?type=MSA');
      expect(filtered.body.contracts).toHaveLength(1);
      // The summary describes the account, not the filtered view.
      expect(filtered.body.summary).toEqual({ total: 3, nda: 2, msa: 1 });

      const paged = await api<{ contracts: unknown[]; page: number; total: number }>(
        lister,
        '/api/contracts?page=2&page_size=2',
      );
      expect(paged.body.contracts).toHaveLength(1);
      expect(paged.body.total).toBe(3);
    } finally {
      await destroyUser(lister);
    }
  }, 180_000);

  it('rejects an unknown sort column with a field map', async () => {
    const res = await api<{ error: { code: string; fields: Record<string, string> } }>(
      user,
      '/api/contracts?sort=contract_text',
    );
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION');
    expect(res.body.error.fields.sort).toMatch(/created_at/);
  });

  it('rejects page_size above 50 rather than clamping it', async () => {
    // Spec 01 §7 is normative: `.max(50)` rejects. Spec 09 §5 was corrected to
    // match — silently substituting a different page_size would make the
    // pagination contract dishonest.
    const res = await api<{ error: { code: string; fields: Record<string, string> } }>(
      user,
      '/api/contracts?page_size=500',
    );
    expect(res.status).toBe(400);
    expect(res.body.error.fields.page_size).toBeTruthy();
  });

  it("never returns another user's contracts", async () => {
    const stranger = await createUser('stranger');
    try {
      const res = await api<{ contracts: unknown[]; total: number }>(stranger, '/api/contracts');
      expect(res.body.contracts).toHaveLength(0);
      expect(res.body.total).toBe(0);
    } finally {
      await destroyUser(stranger);
    }
  }, 60_000);
});

describe('GET /api/contracts/{id}', () => {
  it('advances last_accessed_at — the 90-day retention anchor', async () => {
    const id = await processedContract();

    const { data: before } = await admin()
      .from('contracts')
      .select('last_accessed_at')
      .eq('id', id)
      .single();

    await new Promise((r) => setTimeout(r, 1100));
    await api(user, `/api/contracts/${id}`);

    const { data: after } = await admin()
      .from('contracts')
      .select('last_accessed_at')
      .eq('id', id)
      .single();

    expect(new Date(after!.last_accessed_at as string).getTime()).toBeGreaterThan(
      new Date(before!.last_accessed_at as string).getTime(),
    );
  }, 90_000);
});

describe('PATCH /api/key-terms/{id}', () => {
  it('sets is_edited and never touches original_ai_value', async () => {
    const id = await processedContract();
    const { data: term } = await user.client
      .from('key_terms')
      .select('id, value, original_ai_value')
      .eq('contract_id', id)
      .eq('term_name', 'Governing Law')
      .single();

    const res = await api<{ value: string; is_edited: boolean; original_ai_value: string }>(
      user,
      `/api/key-terms/${term!.id}`,
      { method: 'PATCH', body: JSON.stringify({ value: 'Laws of New York' }) },
    );

    expect(res.status).toBe(200);
    expect(res.body.value).toBe('Laws of New York');
    expect(res.body.is_edited).toBe(true);
    expect(res.body.original_ai_value).toBe(term!.original_ai_value);
  }, 90_000);

  it('rejects 0 and 2001 characters with INVALID_VALUE', async () => {
    const id = await processedContract();
    const { data: term } = await user.client
      .from('key_terms')
      .select('id')
      .eq('contract_id', id)
      .limit(1)
      .single();

    for (const value of ['', 'x'.repeat(2001)]) {
      const res = await api<{ error: { code: string } }>(user, `/api/key-terms/${term!.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ value }),
      });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('INVALID_VALUE');
    }
  }, 90_000);

  it('404s an unknown term id, naming the right noun', async () => {
    const res = await api<{ error: { code: string; message: string } }>(
      user,
      '/api/key-terms/00000000-0000-0000-0000-000000000000',
      { method: 'PATCH', body: JSON.stringify({ value: 'x' }) },
    );
    expect(res.status).toBe(404);
    expect(res.body.error.message).toBe("We couldn't find that key term.");
  });
});

describe('POST /api/contracts/{id}/signed-url', () => {
  it('returns a 1-hour URL, and NO_FILE once the PDF is gone', async () => {
    const id = await processedContract();

    const ok = await api<{ url: string; expires_in: number }>(
      user,
      `/api/contracts/${id}/signed-url`,
      { method: 'POST' },
    );
    expect(ok.status).toBe(200);
    expect(ok.body.expires_in).toBe(3600);

    await admin().from('contracts').update({ file_path: null }).eq('id', id);

    const gone = await api<{ error: { code: string } }>(user, `/api/contracts/${id}/signed-url`, {
      method: 'POST',
    });
    expect(gone.status).toBe(404);
    expect(gone.body.error.code).toBe('NO_FILE');
  }, 90_000);
});

describe('POST /api/contracts/{id}/complete', () => {
  it('is idempotent and returns a stable ISO timestamp', async () => {
    const id = await processedContract();

    const first = await api<{ review_completed_at: string }>(
      user,
      `/api/contracts/${id}/complete`,
      { method: 'POST' },
    );
    await new Promise((r) => setTimeout(r, 1100));
    const second = await api<{ review_completed_at: string }>(
      user,
      `/api/contracts/${id}/complete`,
      { method: 'POST' },
    );

    expect(first.status).toBe(200);
    expect(second.body.review_completed_at).toBe(first.body.review_completed_at);
    expect(first.body.review_completed_at).toMatch(/Z$/);
  }, 90_000);
});

describe('POST /api/feedback', () => {
  it('upserts one row per (user, contract) and denormalises contract_type', async () => {
    const id = await processedContract();

    const first = await api<{ rating: string; contract_type: string }>(user, '/api/feedback', {
      method: 'POST',
      body: JSON.stringify({ contract_id: id, rating: 'up', survey_accuracy: 'yes' }),
    });
    expect(first.status).toBe(201);
    expect(first.body.contract_type).toBe('NDA');

    const second = await api<{ rating: string; comment: string }>(user, '/api/feedback', {
      method: 'POST',
      body: JSON.stringify({ contract_id: id, rating: 'down', comment: 'Missed a clause' }),
    });
    expect(second.body.rating).toBe('down');

    const { count } = await user.client
      .from('user_feedback')
      .select('id', { count: 'exact', head: true })
      .eq('contract_id', id);
    expect(count).toBe(1);
  }, 90_000);

  it('rejects an over-length comment and an unknown contract', async () => {
    const id = await processedContract();

    const long = await api(user, '/api/feedback', {
      method: 'POST',
      body: JSON.stringify({ contract_id: id, rating: 'up', comment: 'x'.repeat(1001) }),
    });
    expect(long.status).toBe(400);

    const unknown = await api<{ error: { code: string } }>(user, '/api/feedback', {
      method: 'POST',
      body: JSON.stringify({ contract_id: '00000000-0000-0000-0000-000000000000', rating: 'up' }),
    });
    expect(unknown.status).toBe(404);
  }, 90_000);
});

describe('POST /api/nps', () => {
  it('accepts one response then 409s within 30 days', async () => {
    const responder = await createUser('nps');
    try {
      const first = await api<{ score: number }>(responder, '/api/nps', {
        method: 'POST',
        body: JSON.stringify({ score: 9 }),
      });
      expect(first.status).toBe(201);

      const second = await api<{ error: { code: string } }>(responder, '/api/nps', {
        method: 'POST',
        body: JSON.stringify({ score: 4 }),
      });
      expect(second.status).toBe(409);
      expect(second.body.error.code).toBe('ALREADY_SURVEYED');
    } finally {
      await destroyUser(responder);
    }
  }, 60_000);

  it('rejects scores outside 0-10', async () => {
    for (const score of [-1, 11]) {
      const res = await api(user, '/api/nps', {
        method: 'POST',
        body: JSON.stringify({ score }),
      });
      expect(res.status).toBe(400);
    }
  });
});

describe('DELETE /api/contracts/{id}', () => {
  it('204s, cascades every child table and removes the Storage object', async () => {
    const id = await processedContract();
    await api(user, '/api/feedback', {
      method: 'POST',
      body: JSON.stringify({ contract_id: id, rating: 'up' }),
    });

    const { data: contract } = await admin()
      .from('contracts')
      .select('file_path')
      .eq('id', id)
      .single();
    expect(contract?.file_path).not.toBeNull();

    const res = await api(user, `/api/contracts/${id}`, { method: 'DELETE' });
    expect(res.status).toBe(204);

    for (const table of ['key_terms', 'user_feedback', 'processing_runs', 'openai_calls'] as const) {
      const { count } = await admin()
        .from(table)
        .select('id', { count: 'exact', head: true })
        .eq('contract_id', id);
      expect(count, `${table} should be empty`).toBe(0);
    }

    const { data: object } = await admin().storage.from('contracts').list(`${user.id}/${id}`);
    expect(object ?? []).toHaveLength(0);
  }, 120_000);

  it('404s a repeat delete and another user\'s id', async () => {
    const id = await processedContract();
    expect((await api(user, `/api/contracts/${id}`, { method: 'DELETE' })).status).toBe(204);
    expect((await api(user, `/api/contracts/${id}`, { method: 'DELETE' })).status).toBe(404);
  }, 90_000);
});

describe('DELETE /api/account', () => {
  it('purges Storage BEFORE the auth user, leaving zero orphans', async () => {
    const doomed = await createUser('erasure');
    await setPlan(doomed, 'pro');

    await uploadPdf(doomed, SHORT_NDA, 'NDA');
    await uploadPdf(doomed, SHORT_NDA, 'MSA');

    const { data: before } = await admin().storage.from('contracts').list(doomed.id);
    expect((before ?? []).length).toBe(2);

    const res = await api(doomed, '/api/account', { method: 'DELETE' });
    expect(res.status).toBe(204);

    // The DB cascade does NOT reach storage.objects — verified live in Slice 3.
    // This assertion is the regression guard for that ordering.
    const { data: after } = await admin().storage.from('contracts').list(doomed.id);
    expect(after ?? []).toHaveLength(0);

    const { count: profiles } = await admin()
      .from('profiles')
      .select('id', { count: 'exact', head: true })
      .eq('id', doomed.id);
    expect(profiles).toBe(0);

    const { count: contracts } = await admin()
      .from('contracts')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', doomed.id);
    expect(contracts).toBe(0);

    // The session is dead afterwards.
    const stale = await api(doomed, '/api/contracts');
    expect(stale.status).toBe(401);
  }, 180_000);
});
