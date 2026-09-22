import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Route 32, `PUT /api/hhh-scores` (spec 22 §4).
 *
 * Two things this route must never get wrong. It must not write the verdict
 * columns — the `compute_hhh_verdicts` trigger owns those, and a client that
 * sends them is asserting a pillar outcome it did not compute. And it must
 * behave as an upsert without an `on_conflict` target: the uniqueness is a
 * PARTIAL index (`WHERE evaluator='human'`), which PostgREST cannot aim at, so
 * the route selects the reviewer's existing row and updates it, falling back
 * to an update if a concurrent insert wins the race.
 */

interface Row {
  id: string;
  [column: string]: unknown;
}

interface FakeState {
  contract: Record<string, unknown> | null;
  subject: Record<string, unknown> | null;
  /** The contract the fake message's session belongs to. */
  messageContractId: string;
  /** What the owner's human-row count query returns. */
  humanRowCount: number;
  existing: Row | null;
  /** Rows written, in order, as `{ table, op, payload }`. */
  writes: Array<{ table: string; op: 'insert' | 'update'; payload: Record<string, unknown> }>;
  /** Set to make the next insert fail with a unique violation. */
  insertConflict: boolean;
  returned: Row;
}

const state: FakeState = {
  contract: null,
  subject: null,
  messageContractId: '',
  humanRowCount: 0,
  existing: null,
  writes: [],
  insertConflict: false,
  returned: { id: 'score-1', helpful_verdict: 'pass', honest_verdict: 'fail', harmless_verdict: 'pass' },
};

vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: () => ({
    auth: { getUser: async () => ({ data: { user: { id: 'u1' } } }) },
    from(table: string) {
      let op: 'select' | 'insert' | 'update' = 'select';
      let countMode = false;
      const filters: Record<string, unknown> = {};
      const q = {
        select: (_cols?: string, opts?: { count?: string; head?: boolean }) => {
          if (opts?.count) countMode = true;
          return q;
        },
        eq: (column: string, value: unknown) => {
          filters[column] = value;
          return q;
        },
        is: () => q,
        /** A head+count query is awaited directly, not through maybeSingle. */
        then(resolve: (v: unknown) => void) {
          resolve(countMode ? { count: state.humanRowCount, error: null } : { data: null, error: null });
        },
        insert(payload: Record<string, unknown>) {
          op = 'insert';
          state.writes.push({ table, op: 'insert', payload });
          return q;
        },
        update(payload: Record<string, unknown>) {
          op = 'update';
          state.writes.push({ table, op: 'update', payload });
          return q;
        },
        async maybeSingle() {
          if (op === 'insert') {
            if (state.insertConflict) {
              state.insertConflict = false;
              // The concurrent save that won the race left its row behind.
              state.existing = { id: 'score-1' };
              return { data: null, error: { code: '23505', message: 'duplicate key' } };
            }
            return { data: state.returned, error: null };
          }
          if (op === 'update') return { data: state.returned, error: null };
          if (table === 'contracts') return { data: state.contract, error: null };
          if (table === 'hhh_scores') return { data: state.existing, error: null };
          if (table === 'chat_messages') {
            // A message is only visible when the query scoped it to the
            // contract its session actually belongs to.
            const wanted = filters['chat_sessions.contract_id'];
            if (wanted !== undefined && wanted !== state.messageContractId) {
              return { data: null, error: null };
            }
            return { data: state.subject, error: null };
          }
          return { data: state.subject, error: null };
        },
        async single() {
          return q.maybeSingle();
        },
      };
      return q;
    },
  }),
}));

import { PUT } from '@/app/api/hhh-scores/route';

const CONTRACT_ID = '11111111-1111-4111-8111-111111111111';
const TERM_ID = '22222222-2222-4222-8222-222222222222';
const MESSAGE_ID = '33333333-3333-4333-8333-333333333333';

function put(body: unknown) {
  return PUT(
    new Request('http://localhost/api/hhh-scores', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );
}

async function code(res: Response): Promise<string> {
  const body = (await res.json()) as { error?: { code?: string } };
  return body.error?.code ?? '';
}

/** The one `hhh_scores` payload the route wrote. */
function payload(): Record<string, unknown> {
  const writes = state.writes.filter((w) => w.table === 'hhh_scores');
  expect(writes).toHaveLength(1);
  return writes[0]!.payload;
}

const TERM_BODY = {
  contract_id: CONTRACT_ID,
  subject_type: 'term' as const,
  term_id: TERM_ID,
  answers: { H1: false, H4: true, O5: null },
};

beforeEach(() => {
  state.contract = { id: CONTRACT_ID, prompt_version: 'v2.0', term_library_version: 'lib-1' };
  state.subject = { id: TERM_ID };
  state.messageContractId = CONTRACT_ID;
  state.humanRowCount = 1;
  state.existing = null;
  state.writes = [];
  state.insertConflict = false;
});

describe('route 32 validation (spec 22 §4)', () => {
  it('rejects an unknown subject type', async () => {
    const res = await put({ ...TERM_BODY, subject_type: 'clause' });

    expect(res.status).toBe(400);
    expect(state.writes).toHaveLength(0);
  });

  it('rejects a term with no term_id', async () => {
    const res = await put({ contract_id: CONTRACT_ID, subject_type: 'term', answers: { H1: true } });

    expect(res.status).toBe(400);
    expect(await code(res)).toBe('INVALID_HHH_ANSWERS');
  });

  it('rejects a payload carrying two subject ids', async () => {
    const res = await put({ ...TERM_BODY, message_id: MESSAGE_ID });

    expect(res.status).toBe(400);
    expect(await code(res)).toBe('INVALID_HHH_ANSWERS');
    expect(state.writes).toHaveLength(0);
  });

  it('rejects a summary carrying a subject id', async () => {
    const res = await put({ contract_id: CONTRACT_ID, subject_type: 'summary', term_id: TERM_ID, answers: { H1: true } });

    expect(res.status).toBe(400);
    expect(await code(res)).toBe('INVALID_HHH_ANSWERS');
  });

  it('rejects a code this subject type is never asked', async () => {
    // H11 is a term-only code; a chat answer is never asked it.
    const res = await put({
      contract_id: CONTRACT_ID,
      subject_type: 'message',
      message_id: MESSAGE_ID,
      answers: { H1: true, H11: false },
    });

    expect(res.status).toBe(400);
    expect(await code(res)).toBe('INVALID_HHH_ANSWERS');
    expect(state.writes).toHaveLength(0);
  });

  it('rejects an answer that is neither Yes, No nor Skip', async () => {
    const res = await put({ ...TERM_BODY, answers: { H1: 'maybe' } });

    expect(res.status).toBe(400);
  });

  it('rejects notes over 1,000 characters', async () => {
    const res = await put({ ...TERM_BODY, notes: 'x'.repeat(1001) });

    expect(res.status).toBe(400);
  });

  it('accepts notes at the limit', async () => {
    const res = await put({ ...TERM_BODY, notes: 'x'.repeat(1000) });

    expect(res.status).toBe(200);
  });
});

describe('route 32 ownership (spec 22 §4)', () => {
  it('is 404 when the contract is not the caller’s', async () => {
    state.contract = null;

    const res = await put(TERM_BODY);

    expect(res.status).toBe(404);
    expect(state.writes).toHaveLength(0);
  });

  it('is 404 when the term is not on that contract', async () => {
    state.subject = null;

    const res = await put(TERM_BODY);

    expect(res.status).toBe(404);
    expect(state.writes).toHaveLength(0);
  });

  it('is 404 when the message is not on that contract', async () => {
    state.subject = null;

    const res = await put({
      contract_id: CONTRACT_ID,
      subject_type: 'message',
      message_id: MESSAGE_ID,
      answers: { H1: true },
    });

    expect(res.status).toBe(404);
  });
});

describe('route 32 payload (spec 22 §3, §4)', () => {
  it('stamps the human-reviewer identity the RLS policy requires', async () => {
    await put(TERM_BODY);

    expect(payload()).toMatchObject({
      user_id: 'u1',
      created_by: 'u1',
      evaluator: 'human',
      scorer_role: 'owner',
      contract_id: CONTRACT_ID,
      subject_type: 'term',
      term_id: TERM_ID,
    });
  });

  it('copies the versions from the contract, so rates are never mixed across libraries', async () => {
    await put(TERM_BODY);

    expect(payload()).toMatchObject({ prompt_version: 'v2.0', term_library_version: 'lib-1' });
  });

  it('maps each code to its lower-case column, with Skip as null', async () => {
    await put(TERM_BODY);

    expect(payload()).toMatchObject({ h1: false, h4: true, o5: null });
  });

  it('never sends a verdict column — the trigger owns those', async () => {
    await put(TERM_BODY);

    const keys = Object.keys(payload());
    expect(keys).not.toContain('helpful_verdict');
    expect(keys).not.toContain('honest_verdict');
    expect(keys).not.toContain('harmless_verdict');
  });

  it('sends no subject id for a summary', async () => {
    await put({ contract_id: CONTRACT_ID, subject_type: 'summary', answers: { H1: true } });

    const written = payload();
    expect(written.subject_type).toBe('summary');
    expect(written.term_id ?? null).toBeNull();
    expect(written.message_id ?? null).toBeNull();
  });

  it('returns the verdicts the trigger computed', async () => {
    const res = await put(TERM_BODY);

    expect(res.status).toBe(200);
    // 5d-3a adds `human_row_count` for the Review footer (L13).
    expect(await res.json()).toEqual({
      id: 'score-1',
      helpful_verdict: 'pass',
      honest_verdict: 'fail',
      harmless_verdict: 'pass',
      human_row_count: 1,
    });
  });
});

describe('route 32 upsert without an on_conflict target (spec 22 §4)', () => {
  it('inserts when the reviewer has not scored this subject', async () => {
    await put(TERM_BODY);

    expect(state.writes.filter((w) => w.table === 'hhh_scores').map((w) => w.op)).toEqual(['insert']);
  });

  it('updates the reviewer’s existing row on a second save', async () => {
    state.existing = { id: 'score-1' };

    await put(TERM_BODY);

    const writes = state.writes.filter((w) => w.table === 'hhh_scores');
    expect(writes.map((w) => w.op)).toEqual(['update']);
    // An update must not try to move the row to another subject or reviewer.
    expect(Object.keys(writes[0]!.payload)).not.toContain('created_by');
    expect(Object.keys(writes[0]!.payload)).not.toContain('contract_id');
  });

  it('retries once as an update when a concurrent insert wins (23505)', async () => {
    state.insertConflict = true;

    const res = await put(TERM_BODY);

    expect(res.status).toBe(200);
    expect(state.writes.filter((w) => w.table === 'hhh_scores').map((w) => w.op)).toEqual(['insert', 'update']);
  });

  it('clears an answer the reviewer changed back to Skip', async () => {
    state.existing = { id: 'score-1' };

    await put({ ...TERM_BODY, answers: { H1: null } });

    const writes = state.writes.filter((w) => w.table === 'hhh_scores');
    expect(writes[0]!.payload).toMatchObject({ h1: null });
  });
});

/**
 * Stage 5d-3a item 2. A message was checked for ownership but not for which
 * contract it belongs to, so an owner with two contracts could file a score
 * against the wrong one — the answers would then count towards a contract the
 * answer was never about.
 */
describe('route 32 scopes a message to its contract (5d-3a)', () => {
  const MESSAGE_BODY = {
    contract_id: CONTRACT_ID,
    subject_type: 'message' as const,
    message_id: MESSAGE_ID,
    answers: { H1: true },
  };

  it('accepts a message whose session belongs to the contract', async () => {
    const res = await put(MESSAGE_BODY);

    expect(res.status).toBe(200);
  });

  it('is 404 when the message belongs to another contract of the same owner', async () => {
    state.messageContractId = '44444444-4444-4444-8444-444444444444';

    const res = await put(MESSAGE_BODY);

    expect(res.status).toBe(404);
    expect(state.writes).toHaveLength(0);
  });
});

/**
 * Stage 5d-3a item 1 (L13). The footer's "k human rows total" was hardcoded:
 * nothing ever fetched it and nothing refreshed it after a save, so it read 0
 * however many rows the reviewer had. The count now comes back with every
 * successful save, so the first one corrects it.
 */
describe('route 32 returns the reviewer’s human-row count (L13)', () => {
  it('includes the count on an insert', async () => {
    state.humanRowCount = 1;

    const res = await put(TERM_BODY);

    expect(await res.json()).toMatchObject({ human_row_count: 1 });
  });

  it('includes the count on an update', async () => {
    state.existing = { id: 'score-1' };
    state.humanRowCount = 7;

    const res = await put(TERM_BODY);

    expect(await res.json()).toMatchObject({ human_row_count: 7 });
  });

  it('still returns the verdicts alongside it', async () => {
    const res = await put(TERM_BODY);

    expect(await res.json()).toMatchObject({
      id: 'score-1',
      helpful_verdict: 'pass',
      honest_verdict: 'fail',
      harmless_verdict: 'pass',
    });
  });
});
