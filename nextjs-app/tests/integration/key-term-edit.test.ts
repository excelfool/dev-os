import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  admin,
  api,
  createUser,
  destroyUser,
  startApp,
  stopApp,
  type ErrorEnvelope,
  type TestUser,
} from './harness';

/**
 * Spec 07 v1.1 §D/§G — `PATCH /api/key-terms/{id}` over the real route and the
 * real database: per-field validation, per-field flags, and the one invariant
 * no database constraint enforces — `original_ai_*` is never overwritten.
 *
 * NOT RUN in Stage 5d-2: `.env.local` points at the live `contractiq` project
 * and this suite writes rows there (G35). Run it against a scratch project.
 */

let user: TestUser;
let contractId: string;
let termId: string;

const PAGE_COUNT = 3;

/** The §D success shape, with the error envelope optional so one call site
 *  can assert on either without casting. */
interface TermBody {
  id: string;
  value: string | null;
  page_number: number | null;
  reasoning: string | null;
  is_edited: boolean;
  page_edited: boolean;
  reasoning_edited: boolean;
  original_ai_value: string | null;
  original_ai_page: number | null;
  original_ai_reasoning: string | null;
  edited_at: string | null;
  error?: ErrorEnvelope['error'];
}

/** A completed contract with one term whose three originals are known. */
async function seedContract(): Promise<void> {
  const { data: contract } = await admin()
    .from('contracts')
    .insert({
      user_id: user.id,
      file_name: 'edit-fixture.pdf',
      contract_type: 'MSA',
      status: 'completed',
      page_count: PAGE_COUNT,
      contract_text: '[PAGE 1]\nThis Agreement is governed by the laws of the State of Delaware.',
    })
    .select('id')
    .single();
  contractId = contract!.id as string;

  const { data: term } = await admin()
    .from('key_terms')
    .insert({
      contract_id: contractId,
      user_id: user.id,
      term_name: 'Governing Law',
      value: 'State of Delaware',
      page_number: 1,
      confidence_score: 92,
      source_sentence: 'governed by the laws of the State of Delaware',
      reasoning: 'Clause 9 names Delaware.',
      original_ai_value: 'State of Delaware',
      original_ai_page: 1,
      original_ai_reasoning: 'Clause 9 names Delaware.',
      display_rank: 1,
    })
    .select('id')
    .single();
  termId = term!.id as string;
}

function patch(body: unknown) {
  return api<TermBody>(user, `/api/key-terms/${termId}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
}

async function readTerm() {
  const { data } = await admin()
    .from('key_terms')
    .select(
      'value, page_number, reasoning, is_edited, page_edited, reasoning_edited, original_ai_value, original_ai_page, original_ai_reasoning, edited_at',
    )
    .eq('id', termId)
    .single();
  return data!;
}

beforeAll(async () => {
  await startApp();
  user = await createUser('kt-edit');
  await seedContract();
}, 120_000);

afterAll(async () => {
  await destroyUser(user);
  await stopApp();
});

describe('PATCH /api/key-terms/{id} validation (spec 07 v1.1 §D)', () => {
  it('rejects page 0', async () => {
    const res = await patch({ page_number: 0 });

    expect(res.status).toBe(400);
    expect(res.body.error!.code).toBe('INVALID_PAGE');
  });

  it('rejects a page past the contract page count and names the limit', async () => {
    const res = await patch({ page_number: PAGE_COUNT + 1 });

    expect(res.status).toBe(400);
    expect(res.body.error!.code).toBe('INVALID_PAGE');
    expect(res.body.error!.message).toBe(`Enter a page between 1 and ${PAGE_COUNT}.`);
  });

  it('rejects empty reasoning', async () => {
    const res = await patch({ reasoning: '' });

    expect(res.status).toBe(400);
    expect(res.body.error!.code).toBe('INVALID_REASONING');
  });

  it('rejects an empty body', async () => {
    const res = await patch({});

    expect(res.status).toBe(400);
    expect(res.body.error!.code).toBe('VALIDATION');
  });

  it('leaves the row untouched after every rejection', async () => {
    const row = await readTerm();

    expect(row.value).toBe('State of Delaware');
    expect(row.page_number).toBe(1);
    expect(row.is_edited).toBe(false);
    expect(row.page_edited).toBe(false);
    expect(row.reasoning_edited).toBe(false);
  });
});

describe('PATCH /api/key-terms/{id} keeps the originals (spec 07 v1.1 §D)', () => {
  it('a page edit sets page_edited and leaves original_ai_page untouched', async () => {
    const res = await patch({ page_number: 2 });

    expect(res.status).toBe(200);
    expect(res.body.page_number).toBe(2);
    expect(res.body.page_edited).toBe(true);
    expect(res.body.original_ai_page).toBe(1);

    const row = await readTerm();
    expect(row.page_number).toBe(2);
    expect(row.page_edited).toBe(true);
    expect(row.original_ai_page).toBe(1);
    // Untouched by a page-only edit.
    expect(row.is_edited).toBe(false);
    expect(row.reasoning_edited).toBe(false);
  });

  it('a reasoning edit sets reasoning_edited and leaves original_ai_reasoning untouched', async () => {
    const res = await patch({ reasoning: 'Clause 12 fixes the venue in New York.' });

    expect(res.status).toBe(200);
    expect(res.body.reasoning_edited).toBe(true);
    expect(res.body.original_ai_reasoning).toBe('Clause 9 names Delaware.');

    const row = await readTerm();
    expect(row.reasoning).toBe('Clause 12 fixes the venue in New York.');
    expect(row.original_ai_reasoning).toBe('Clause 9 names Delaware.');
    expect(row.is_edited).toBe(false);
  });

  it('a value edit sets is_edited and leaves original_ai_value untouched', async () => {
    const res = await patch({ value: 'State of New York' });

    expect(res.status).toBe(200);
    expect(res.body.is_edited).toBe(true);
    expect(res.body.original_ai_value).toBe('State of Delaware');

    const row = await readTerm();
    expect(row.value).toBe('State of New York');
    expect(row.original_ai_value).toBe('State of Delaware');
    expect(row.edited_at).not.toBeNull();
  });

  it('all three originals survive an edit of all three fields at once', async () => {
    const res = await patch({ value: 'Texas', page_number: 3, reasoning: 'Clause 14.' });

    expect(res.status).toBe(200);

    const row = await readTerm();
    expect(row).toMatchObject({
      value: 'Texas',
      page_number: 3,
      reasoning: 'Clause 14.',
      is_edited: true,
      page_edited: true,
      reasoning_edited: true,
      original_ai_value: 'State of Delaware',
      original_ai_page: 1,
      original_ai_reasoning: 'Clause 9 names Delaware.',
    });
  });
});

describe('PATCH /api/key-terms/{id} ownership', () => {
  it("is 404 for another user's term", async () => {
    const other = await createUser('kt-edit-other');
    try {
      const res = await api<TermBody>(other, `/api/key-terms/${termId}`, {
        method: 'PATCH',
        body: JSON.stringify({ value: 'nope' }),
      });

      expect(res.status).toBe(404);

      const row = await readTerm();
      expect(row.value).toBe('Texas');
    } finally {
      await destroyUser(other);
    }
  });
});
