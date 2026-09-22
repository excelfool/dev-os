import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  adminClient,
  createAccount,
  destroyAccount,
  seedContract,
  type SeededData,
  type TestAccount,
} from './harness';

/**
 * `hhh_scores` RLS (spec 22 §3, spec 02 v1.1 §D).
 *
 * The rule is stronger than "own rows": INSERT and UPDATE additionally require
 * `created_by = auth.uid()`, so an owner can never alter the SME's or the
 * judge's rows about their own contract. Those rows are the evidence the
 * evaluation rests on; if the person being measured could edit them, the HHH
 * rate would measure nothing.
 *
 * NOT RUN in Stage 5d-3: `.env.local` points at the live `contractiq` project
 * and this suite writes rows there (G35). Run it against a scratch project.
 */

let alice: TestAccount;
let bob: TestAccount;
let aliceData: SeededData;

beforeAll(async () => {
  alice = await createAccount('hhh-a');
  bob = await createAccount('hhh-b');
  aliceData = await seedContract(alice);
}, 120_000);

afterAll(async () => {
  await destroyAccount(alice);
  await destroyAccount(bob);
});

function humanRow(account: TestAccount, data: SeededData, overrides: Record<string, unknown> = {}) {
  return {
    user_id: account.id,
    contract_id: data.contractId,
    subject_type: 'term',
    term_id: data.keyTermId,
    evaluator: 'human',
    scorer_role: 'owner',
    created_by: account.id,
    prompt_version: 'v2.0',
    h1: false,
    ...overrides,
  };
}

describe('hhh_scores RLS (spec 22 §3)', () => {
  it('lets an owner score their own contract', async () => {
    const { error } = await alice.client.from('hhh_scores').insert(humanRow(alice, aliceData));

    expect(error).toBeNull();
  });

  it('computes the verdicts from the polarity table, not from the client', async () => {
    // H1 is yes_is_failure, so H1=true must fail the helpful pillar even
    // though the insert above asked for nothing.
    await alice.client
      .from('hhh_scores')
      .update({ h1: true })
      .eq('contract_id', aliceData.contractId)
      .eq('created_by', alice.id);

    const { data } = await alice.client
      .from('hhh_scores')
      .select('helpful_verdict, honest_verdict, harmless_verdict')
      .eq('contract_id', aliceData.contractId)
      .single();

    expect(data!.helpful_verdict).toBe('fail');
    expect(data!.honest_verdict).toBe('pass');
  });

  it('ignores a verdict a client tries to write', async () => {
    await alice.client
      .from('hhh_scores')
      .update({ h1: false, helpful_verdict: 'fail' })
      .eq('contract_id', aliceData.contractId)
      .eq('created_by', alice.id);

    const { data } = await alice.client
      .from('hhh_scores')
      .select('helpful_verdict')
      .eq('contract_id', aliceData.contractId)
      .single();

    // The trigger recomputed it: H1=false is a pass.
    expect(data!.helpful_verdict).toBe('pass');
  });

  it('holds one human row per subject per reviewer', async () => {
    const { error } = await alice.client.from('hhh_scores').insert(humanRow(alice, aliceData, { h2: true }));

    // hhh_scores_human_one_per_term.
    expect(error?.code).toBe('23505');
  });

  it("refuses a row whose created_by is not the caller", async () => {
    const { error } = await alice.client
      .from('hhh_scores')
      .insert(humanRow(alice, aliceData, { term_id: null, subject_type: 'summary', created_by: bob.id }));

    expect(error).not.toBeNull();
  });

  it("does not let B read A's scores", async () => {
    const { data } = await bob.client
      .from('hhh_scores')
      .select('id')
      .eq('contract_id', aliceData.contractId);

    expect(data).toEqual([]);
  });

  it("does not let B write a score on A's contract", async () => {
    const { error } = await bob.client.from('hhh_scores').insert(humanRow(bob, aliceData));

    expect(error).not.toBeNull();
  });

  it("does not let A alter an SME row about A's own contract", async () => {
    const admin = adminClient();
    const { data: sme } = await admin
      .from('hhh_scores')
      .insert({
        user_id: alice.id,
        contract_id: aliceData.contractId,
        subject_type: 'summary',
        evaluator: 'human',
        scorer_role: 'sme',
        created_by: bob.id, // stands in for the operator account
        prompt_version: 'v2.0',
        h1: true,
      })
      .select('id')
      .single();

    const { data: updated } = await alice.client
      .from('hhh_scores')
      .update({ h1: false })
      .eq('id', sme!.id)
      .select('id');

    // RLS filtered the row out: nothing was updated.
    expect(updated ?? []).toEqual([]);

    await admin.from('hhh_scores').delete().eq('id', sme!.id);
  });

  it('refuses a judge row carrying a scorer_role', async () => {
    const { error } = await adminClient()
      .from('hhh_scores')
      .insert({
        user_id: alice.id,
        contract_id: aliceData.contractId,
        subject_type: 'summary',
        evaluator: 'llm-judge',
        scorer_role: 'owner',
        judge_model: 'gpt-4o',
        judge_prompt_version: 'judge.v1',
        prompt_version: 'v2.0',
      });

    // hhh_scores_scorer_role_by_evaluator_check.
    expect(error).not.toBeNull();
  });
});
