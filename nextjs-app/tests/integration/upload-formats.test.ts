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
import { SCANNED_PDF, SHORT_NDA, makePdf } from './pdf-fixtures';

/**
 * Spec 21 §9 / spec 04 v1.1 §C — upload formats, the capabilities route and
 * D46 duplicate detection. OCR stays unconfigured in this environment, so the
 * configured-OCR branches are not exercised here (see report).
 */

// A minimal ZIP local-file-header: what a real .docx starts with.
const DOCX_BYTES = Buffer.concat([Buffer.from('PK\x03\x04'), Buffer.alloc(64, 0)]);

let user: TestUser;

beforeAll(async () => {
  await startApp();
  user = await createUser('formats');
}, 180_000);

afterAll(async () => {
  await destroyUser(user);
  await stopApp();
}, 120_000);

async function snapshot(u: TestUser) {
  const { data: profile } = await u.client
    .from('profiles')
    .select('analyses_used')
    .eq('id', u.id)
    .single();
  const { count } = await u.client.from('contracts').select('id', { count: 'exact', head: true });
  return { used: profile?.analyses_used, rows: count };
}

describe('POST /api/contracts/upload — formats', () => {
  it('a .docx returns 422 UNSUPPORTED_FORMAT with the exact message, stores nothing, charges nothing', async () => {
    const before = await snapshot(user);
    const res = await uploadPdf(user, DOCX_BYTES, 'NDA', 'agreement.docx');
    expect(res.status).toBe(422);
    expect(res.body.error!.code).toBe('UNSUPPORTED_FORMAT');
    expect(res.body.error!.message).toBe(
      "Word documents aren't supported yet — export the contract as a PDF and upload that. DOCX support arrives in v1.1.",
    );
    const after = await snapshot(user);
    expect(after.rows).toBe(before.rows);
    expect(after.used).toBe(before.used);
  });

  it('a renamed .docx with a .pdf extension is still 400 NOT_A_PDF', async () => {
    const res = await uploadPdf(user, DOCX_BYTES, 'NDA', 'disguised.pdf');
    expect(res.status).toBe(400);
    expect(res.body.error!.code).toBe('NOT_A_PDF');
  });

  it('a scanned PDF is still 422 SCANNED_PDF while OCR is unconfigured', async () => {
    const res = await uploadPdf(user, SCANNED_PDF, 'NDA');
    expect(res.status).toBe(422);
    expect(res.body.error!.code).toBe('SCANNED_PDF');
  });
});

describe('D46 — content-hash duplicate detection', () => {
  it('the same bytes uploaded twice: the second 201 carries duplicate_of', async () => {
    const first = await uploadPdf(user, SHORT_NDA, 'NDA', 'same.pdf');
    expect(first.status).toBe(201);
    const second = await uploadPdf(user, SHORT_NDA, 'NDA', 'same-again.pdf');
    expect(second.status).toBe(201);
    expect(second.body.contract_id).not.toBe(first.body.contract_id);

    const body = second.body as unknown as { duplicate_of?: string; duplicate_created_at?: string };
    expect(body.duplicate_of).toBeTruthy();
    expect(body.duplicate_created_at).toBeTruthy();

    // Both rows exist and carry the same hash — reported, never rejected.
    const { data } = await user.client
      .from('contracts')
      .select('id, content_hash')
      .in('id', [first.body.contract_id, second.body.contract_id]);
    expect(data).toHaveLength(2);
    expect(data![0]!.content_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(data![0]!.content_hash).toBe(data![1]!.content_hash);
  });

  it('different bytes: the field is absent', async () => {
    const fresh = await createUser('nodup');
    try {
      const pdf = makePdf(
        `Unique agreement ${Date.now()}. ` +
          Array.from({ length: 120 }, (_, i) => `Clause ${i} binds both parties equally.`).join(' '),
      );
      const res = await uploadPdf(fresh, pdf, 'MSA');
      expect(res.status).toBe(201);
      expect((res.body as unknown as Record<string, unknown>).duplicate_of).toBeUndefined();
    } finally {
      await destroyUser(fresh);
    }
  }, 60_000);
});

describe('GET /api/capabilities', () => {
  it('401 without a session', async () => {
    const res = await api(null, '/api/capabilities');
    expect(res.status).toBe(401);
  });

  it('returns the full registry, sorted by key, with a session', async () => {
    const res = await api<{ capabilities: Array<{ key: string; status: string }>; commit: string }>(
      user,
      '/api/capabilities',
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('private, max-age=3600');
    const keys = res.body.capabilities.map((c) => c.key);
    expect(keys).toHaveLength(37);
    expect(keys).toEqual([...keys].sort());
    expect(res.body.capabilities.find((c) => c.key === 'ingest.docx')?.status).toBe('stub');
    expect(res.body.capabilities.find((c) => c.key === 'versioning.duplicate_detect')?.status).toBe('built');
  });
});
