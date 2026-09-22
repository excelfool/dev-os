import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Stage 5d-2 (spec 07 v1.1 §D, spec 12 route 9): `PATCH /api/key-terms/{id}`
 * accepts any non-empty subset of `{ value, page_number, reasoning }`, sets
 * only the edited-flags for the fields present, and NEVER writes an
 * `original_ai_*` column — those are what make the correction-rate metric and
 * the "what did the AI actually say" audit trail meaningful.
 */

const deriveKeyDatesBounded = vi.fn(async () => undefined);
vi.mock('@/lib/services/reminder-service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/services/reminder-service')>();
  return { ...actual, deriveKeyDatesBounded: () => deriveKeyDatesBounded() };
});

interface FakeState {
  term: Record<string, unknown> | null;
  contract: Record<string, unknown> | null;
  updates: Array<Record<string, unknown>>;
  updated: Record<string, unknown> | null;
}

const state: FakeState = { term: null, contract: null, updates: [], updated: null };

vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: () => ({
    auth: { getUser: async () => ({ data: { user: { id: 'u1' } } }) },
    from(table: string) {
      let isUpdate = false;
      let columns: string[] = [];
      /** PostgREST returns only the selected columns; so does this fake. */
      const project = (row: Record<string, unknown> | null) => {
        if (!row || columns.length === 0) return row;
        return Object.fromEntries(columns.filter((c) => c in row).map((c) => [c, row[c]]));
      };
      const q = {
        select(cols: string) {
          columns = cols.split(',').map((c) => c.trim());
          return q;
        },
        eq: () => q,
        update(values: Record<string, unknown>) {
          isUpdate = true;
          state.updates.push(values);
          return q;
        },
        async maybeSingle() {
          if (isUpdate) return { data: project(state.updated), error: null };
          return { data: project(table === 'key_terms' ? state.term : state.contract), error: null };
        },
        async single() {
          return { data: project(table === 'key_terms' ? state.term : state.contract), error: null };
        },
      };
      return q;
    },
  }),
}));

import { PATCH } from '@/app/api/key-terms/[id]/route';

const TERM_ID = '11111111-1111-1111-1111-111111111111';

function patch(body: unknown) {
  return PATCH(
    new Request(`http://localhost/api/key-terms/${TERM_ID}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
    { params: { id: TERM_ID } },
  );
}

async function errorCode(res: Response): Promise<string> {
  const body = (await res.json()) as { error?: { code?: string; message?: string } };
  return body.error?.code ?? '';
}

/** The single update payload the route sent to `key_terms`. */
function updatePayload(): Record<string, unknown> {
  expect(state.updates).toHaveLength(1);
  return state.updates[0]!;
}

beforeEach(() => {
  state.term = { id: TERM_ID, term_name: 'Governing Law', contract_id: 'c1' };
  state.contract = { page_count: 20, contract_type: 'MSA' };
  state.updates = [];
  state.updated = {
    id: TERM_ID,
    value: 'State of Delaware',
    page_number: 4,
    reasoning: 'The governing-law clause names Delaware.',
    is_edited: true,
    page_edited: false,
    reasoning_edited: false,
    original_ai_value: 'Delaware',
    original_ai_page: 3,
    original_ai_reasoning: 'Clause 9.',
    edited_at: '2026-09-22T00:00:00.000Z',
    term_name: 'Governing Law',
    contract_id: 'c1',
  };
  deriveKeyDatesBounded.mockClear();
});

describe('PATCH /api/key-terms/{id} validation (spec 07 v1.1 §D)', () => {
  it('rejects an empty body with VALIDATION', async () => {
    const res = await patch({});

    expect(res.status).toBe(400);
    expect(await errorCode(res)).toBe('VALIDATION');
    expect(state.updates).toHaveLength(0);
  });

  it.each([['', 'empty'], ['x'.repeat(2001), 'over 2,000 characters']])(
    'rejects a value that is %s with INVALID_VALUE',
    async (value) => {
      const res = await patch({ value });

      expect(res.status).toBe(400);
      expect(await errorCode(res)).toBe('INVALID_VALUE');
      expect(state.updates).toHaveLength(0);
    },
  );

  it.each([[0], [-1], [1.5]])('rejects page_number %s with INVALID_PAGE', async (page_number) => {
    const res = await patch({ page_number });

    expect(res.status).toBe(400);
    expect(await errorCode(res)).toBe('INVALID_PAGE');
    expect(state.updates).toHaveLength(0);
  });

  it('rejects a page beyond the contract page count, naming the limit', async () => {
    const res = await patch({ page_number: 21 });

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe('INVALID_PAGE');
    expect(body.error.message).toBe('Enter a page between 1 and 20.');
    expect(state.updates).toHaveLength(0);
  });

  it('accepts the last page of the contract', async () => {
    const res = await patch({ page_number: 20 });

    expect(res.status).toBe(200);
    expect(updatePayload()).toMatchObject({ page_number: 20 });
  });

  it.each([['', 'empty'], ['x'.repeat(501), 'over 500 characters']])(
    'rejects reasoning that is %s with INVALID_REASONING',
    async (reasoning) => {
      const res = await patch({ reasoning });

      expect(res.status).toBe(400);
      expect(await errorCode(res)).toBe('INVALID_REASONING');
      expect(state.updates).toHaveLength(0);
    },
  );

  it('rejects an unknown field', async () => {
    const res = await patch({ confidence_score: 100 });

    expect(res.status).toBe(400);
    expect(state.updates).toHaveLength(0);
  });
});

describe('PATCH /api/key-terms/{id} per-field flags (spec 07 v1.1 §D)', () => {
  it('a value edit sets is_edited only', async () => {
    await patch({ value: 'State of New York' });

    const payload = updatePayload();
    expect(payload).toMatchObject({ value: 'State of New York', is_edited: true });
    expect(payload).not.toHaveProperty('page_edited');
    expect(payload).not.toHaveProperty('reasoning_edited');
    expect(payload).toHaveProperty('edited_at');
  });

  it('a page edit sets page_edited only', async () => {
    await patch({ page_number: 7 });

    const payload = updatePayload();
    expect(payload).toMatchObject({ page_number: 7, page_edited: true });
    expect(payload).not.toHaveProperty('is_edited');
    expect(payload).not.toHaveProperty('reasoning_edited');
    expect(payload).toHaveProperty('edited_at');
  });

  it('a reasoning edit sets reasoning_edited only', async () => {
    await patch({ reasoning: 'Clause 12 fixes the venue.' });

    const payload = updatePayload();
    expect(payload).toMatchObject({ reasoning: 'Clause 12 fixes the venue.', reasoning_edited: true });
    expect(payload).not.toHaveProperty('is_edited');
    expect(payload).not.toHaveProperty('page_edited');
  });

  it('all three at once sets all three flags and one edited_at', async () => {
    await patch({ value: 'New York', page_number: 2, reasoning: 'Clause 12.' });

    expect(updatePayload()).toMatchObject({
      value: 'New York',
      page_number: 2,
      reasoning: 'Clause 12.',
      is_edited: true,
      page_edited: true,
      reasoning_edited: true,
    });
  });

  it.each([['value'], ['page_number'], ['reasoning']])(
    'never writes an original_ai_* column on a %s edit',
    async (field) => {
      const bodies: Record<string, unknown> = { value: 'x', page_number: 3, reasoning: 'y' };
      await patch({ [field]: bodies[field] });

      const keys = Object.keys(updatePayload());
      expect(keys.filter((k) => k.startsWith('original_ai_'))).toEqual([]);
    },
  );
});

describe('PATCH /api/key-terms/{id} response and side effects', () => {
  it('returns the §D shape, including all three originals', async () => {
    const res = await patch({ value: 'State of Delaware' });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Object.keys(body).sort()).toEqual(
      [
        'edited_at',
        'id',
        'is_edited',
        'original_ai_page',
        'original_ai_reasoning',
        'original_ai_value',
        'page_edited',
        'page_number',
        'reasoning',
        'reasoning_edited',
        'value',
      ].sort(),
    );
  });

  it('re-derives key dates when a reminder-source term value changes', async () => {
    state.term = { id: TERM_ID, term_name: 'Contract end date', contract_id: 'c1' };

    await patch({ value: '2027-03-31' });

    expect(deriveKeyDatesBounded).toHaveBeenCalledTimes(1);
  });

  it('does not re-derive key dates for a page-only edit', async () => {
    state.term = { id: TERM_ID, term_name: 'Contract end date', contract_id: 'c1' };

    await patch({ page_number: 5 });

    expect(deriveKeyDatesBounded).not.toHaveBeenCalled();
  });

  it('is a 404 for a term the user does not own', async () => {
    state.term = null;

    const res = await patch({ value: 'anything' });

    expect(res.status).toBe(404);
    expect(state.updates).toHaveLength(0);
  });
});
