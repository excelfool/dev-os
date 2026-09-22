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
 * Route 32 over the real route and the real database (spec 22 §4).
 *
 * NOT RUN in Stage 5d-3: `.env.local` points at the live `contractiq` project
 * and this suite writes rows there (G35). Run it against a scratch project.
 */

let owner: TestUser;
let contractId: string;
let termId: string;

interface ScoreBody {
  id: string;
  helpful_verdict: string;
  honest_verdict: string;
  harmless_verdict: string;
  error?: ErrorEnvelope['error'];
}

async function seed(user: TestUser): Promise<{ contractId: string; termId: string }> {
  const { data: contract } = await admin()
    .from('contracts')
    .insert({
      user_id: user.id,
      file_name: 'hhh-fixture.pdf',
      contract_type: 'NDA',
      status: 'completed',
      page_count: 1,
      prompt_version: 'v2.0',
      contract_text: '[PAGE 1]\nGoverning law is Delaware.',
    })
    .select('id')
    .single();

  const { data: term } = await admin()
    .from('key_terms')
    .insert({
      contract_id: contract!.id,
      user_id: user.id,
      term_name: 'Governing Law',
      value: 'Delaware',
      page_number: 1,
      confidence_score: 90,
      display_rank: 1,
    })
    .select('id')
    .single();

  return { contractId: contract!.id as string, termId: term!.id as string };
}

function put(user: TestUser, body: unknown) {
  return api<ScoreBody>(user, '/api/hhh-scores', { method: 'PUT', body: JSON.stringify(body) });
}

beforeAll(async () => {
  await startApp();
  owner = await createUser('hhh-owner');
  ({ contractId, termId } = await seed(owner));
}, 120_000);

afterAll(async () => {
  await destroyUser(owner);
  await stopApp();
});

describe('PUT /api/hhh-scores (route 32)', () => {
  it('saves a term score and returns the computed verdicts', async () => {
    const res = await put(owner, {
      contract_id: contractId,
      subject_type: 'term',
      term_id: termId,
      answers: { H1: true, H4: true },
    });

    expect(res.status).toBe(200);
    // H1 is yes_is_failure, so Yes fails the helpful pillar.
    expect(res.body.helpful_verdict).toBe('fail');
    expect(res.body.honest_verdict).toBe('pass');
  });

  it('writes the human-reviewer identity the RLS policy requires', async () => {
    const { data } = await admin()
      .from('hhh_scores')
      .select('evaluator, scorer_role, created_by, user_id, prompt_version, h1, h4')
      .eq('term_id', termId)
      .single();

    expect(data).toMatchObject({
      evaluator: 'human',
      scorer_role: 'owner',
      created_by: owner.id,
      user_id: owner.id,
      prompt_version: 'v2.0',
      h1: true,
      h4: true,
    });
  });

  it('updates the same row on a second save rather than adding one', async () => {
    const res = await put(owner, {
      contract_id: contractId,
      subject_type: 'term',
      term_id: termId,
      answers: { H1: false, H4: true },
    });

    expect(res.status).toBe(200);
    expect(res.body.helpful_verdict).toBe('pass');

    const { data } = await admin().from('hhh_scores').select('id').eq('term_id', termId);
    expect(data).toHaveLength(1);
  });

  it('clears an answer the reviewer changed back to Skip', async () => {
    await put(owner, {
      contract_id: contractId,
      subject_type: 'term',
      term_id: termId,
      answers: { H1: null },
    });

    const { data } = await admin().from('hhh_scores').select('h1, h4').eq('term_id', termId).single();
    expect(data!.h1).toBeNull();
    expect(data!.h4).toBeNull();
  });

  it('scores the summary with no subject id', async () => {
    const res = await put(owner, {
      contract_id: contractId,
      subject_type: 'summary',
      answers: { H1: false, O1: false },
    });

    expect(res.status).toBe(200);
    const { data } = await admin()
      .from('hhh_scores')
      .select('term_id, message_id')
      .eq('contract_id', contractId)
      .eq('subject_type', 'summary')
      .single();
    expect(data!.term_id).toBeNull();
    expect(data!.message_id).toBeNull();
  });

  it('rejects a code the subject type is never asked', async () => {
    const res = await put(owner, {
      contract_id: contractId,
      subject_type: 'summary',
      answers: { H11: true },
    });

    expect(res.status).toBe(400);
    expect(res.body.error!.code).toBe('INVALID_HHH_ANSWERS');
  });

  it('rejects a term payload with no term_id', async () => {
    const res = await put(owner, { contract_id: contractId, subject_type: 'term', answers: { H1: true } });

    expect(res.status).toBe(400);
    expect(res.body.error!.code).toBe('INVALID_HHH_ANSWERS');
  });

  it("is 404 for another user's contract", async () => {
    const other = await createUser('hhh-other');
    try {
      const res = await put(other, {
        contract_id: contractId,
        subject_type: 'term',
        term_id: termId,
        answers: { H1: true },
      });

      expect(res.status).toBe(404);

      const { data } = await admin().from('hhh_scores').select('id').eq('created_by', other.id);
      expect(data).toEqual([]);
    } finally {
      await destroyUser(other);
    }
  });

  it('requires a session', async () => {
    const res = await api(null, '/api/hhh-scores', {
      method: 'PUT',
      body: JSON.stringify({ contract_id: contractId, subject_type: 'summary', answers: {} }),
    });

    expect(res.status).toBe(401);
  });
});
