import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  adminClient,
  anonClient,
  createAccount,
  destroyAccount,
  seedContract,
  TINY_PDF,
  type SeededData,
  type TestAccount,
} from './harness';

/**
 * Spec 02 §8 — the cross-account isolation suite. This is the executable form
 * of PRD Assumption 9; the assumption is UNPROVEN until every check here passes.
 *
 * Both accounts use the anon key. A "pass" means B either sees zero rows or is
 * refused by a policy — never that B sees A's data.
 */

let A: TestAccount;
let B: TestAccount;
let aData: SeededData;

beforeAll(async () => {
  [A, B] = await Promise.all([createAccount('a'), createAccount('b')]);
  aData = await seedContract(A);
}, 120_000);

afterAll(async () => {
  await Promise.all([destroyAccount(A), destroyAccount(B)]);
}, 120_000);

/** Owner-scoped tables, with the column B would have to match to reach a row. */
const OWNED_TABLES = [
  'contracts',
  'key_terms',
  'custom_key_terms',
  'chat_sessions',
  'chat_messages',
  'user_feedback',
  'processing_runs',
  'openai_calls',
  'activity_events',
  'nps_responses',
] as const;

describe('1. B cannot read, update or delete any row owned by A', () => {
  it.each(OWNED_TABLES)('%s — SELECT returns zero rows', async (table) => {
    const { data, error } = await B.client.from(table).select('*');
    expect(error).toBeNull();
    expect(data ?? []).toHaveLength(0);
  });

  it('contracts — B cannot SELECT A\'s row by its exact id', async () => {
    const { data } = await B.client.from('contracts').select('*').eq('id', aData.contractId);
    expect(data ?? []).toHaveLength(0);
  });

  it('contracts — B cannot UPDATE A\'s row', async () => {
    const { data } = await B.client
      .from('contracts')
      .update({ file_name: 'hijacked.pdf' })
      .eq('id', aData.contractId)
      .select('id');
    expect(data ?? []).toHaveLength(0);

    // And the row is genuinely untouched.
    const { data: check } = await A.client
      .from('contracts')
      .select('file_name')
      .eq('id', aData.contractId)
      .single();
    expect(check?.file_name).toBe('rls-fixture.pdf');
  });

  it('key_terms — B cannot UPDATE A\'s term value', async () => {
    await B.client.from('key_terms').update({ value: 'hijacked' }).eq('id', aData.keyTermId);
    const { data } = await A.client
      .from('key_terms')
      .select('value')
      .eq('id', aData.keyTermId)
      .single();
    expect(data?.value).toBe('Delaware');
  });

  it('contracts — B cannot DELETE A\'s row', async () => {
    await B.client.from('contracts').delete().eq('id', aData.contractId);
    const { data } = await A.client.from('contracts').select('id').eq('id', aData.contractId);
    expect(data ?? []).toHaveLength(1);
  });

  it('chat_messages — B cannot DELETE A\'s message', async () => {
    await B.client.from('chat_messages').delete().eq('id', aData.messageId);
    const { data } = await A.client.from('chat_messages').select('id').eq('id', aData.messageId);
    expect(data ?? []).toHaveLength(1);
  });
});

describe('2. B cannot INSERT a row carrying user_id = A (WITH CHECK)', () => {
  it('contracts', async () => {
    const { error } = await B.client.from('contracts').insert({
      user_id: A.id,
      file_name: 'planted.pdf',
      contract_type: 'NDA',
      file_size_bytes: 10,
      page_count: 1,
      token_estimate: 1,
      contract_text: '[PAGE 1]\nplanted',
    });
    expect(error).not.toBeNull();
  });

  it('key_terms', async () => {
    const { error } = await B.client.from('key_terms').insert({
      contract_id: aData.contractId,
      user_id: A.id,
      term_name: 'Planted',
      confidence_score: 100,
    });
    expect(error).not.toBeNull();
  });

  it('activity_events', async () => {
    const { error } = await B.client
      .from('activity_events')
      .insert({ user_id: A.id, event_type: 'results_viewed' });
    expect(error).not.toBeNull();
  });

  it('nps_responses', async () => {
    const { error } = await B.client.from('nps_responses').insert({ user_id: A.id, score: 0 });
    expect(error).not.toBeNull();
  });
});

describe('3. rate_limits and analysis_slots are unreachable from any client', () => {
  it.each(['rate_limits', 'analysis_slots'] as const)(
    '%s — A cannot SELECT, even its own rows',
    async (table) => {
      const { data, error } = await A.client.from(table).select('*');
      // RLS enabled with no policies: either an error or zero rows, never data.
      expect(error !== null || (data ?? []).length === 0).toBe(true);
    },
  );

  it('rate_limits — A cannot INSERT', async () => {
    const { error } = await A.client
      .from('rate_limits')
      .insert({ user_id: A.id, bucket: 'upload', window_start: new Date().toISOString(), count: 0 });
    expect(error).not.toBeNull();
  });

  it('analysis_slots — A cannot UPDATE to free a slot', async () => {
    const { data, error } = await A.client
      .from('analysis_slots')
      .update({ holder: null })
      .eq('slot_id', 1)
      .select('slot_id');
    expect(error !== null || (data ?? []).length === 0).toBe(true);
  });

  it.each([
    ['increment_rate_limit', { p_user_id: '00000000-0000-0000-0000-000000000000', p_bucket: 'upload', p_limit: 20 }],
    ['acquire_analysis_slot', { p_holder: '00000000-0000-0000-0000-000000000000' }],
    ['release_analysis_slot', { p_slot: 1, p_holder: '00000000-0000-0000-0000-000000000000' }],
  ] as const)('A cannot EXECUTE %s', async (fn, args) => {
    const { error } = await A.client.rpc(fn, args as never);
    expect(error).not.toBeNull();
  });
});

describe('3b. persist_key_terms respects ownership', () => {
  const terms = [
    {
      term_name: 'Notice Period',
      value: '30 days',
      page_number: 2,
      confidence_score: 88,
      source_sentence: 'Notice period is 30 days.',
      is_source_verified: true,
      is_custom: false,
      display_rank: 12,
    },
  ];

  it('A can execute it for a contract A owns', async () => {
    const { data, error } = await A.client.rpc('persist_key_terms', {
      p_contract_id: aData.contractId,
      p_terms: terms,
      p_detected_type: 'NDA',
      p_type_mismatch: false,
      p_first_term_ready_ms: 1000,
    });
    expect(error).toBeNull();
    expect((data ?? []).length).toBeGreaterThan(0);
  });

  it("B executing it for A's contract raises and changes nothing", async () => {
    const { count: before } = await A.client
      .from('key_terms')
      .select('id', { count: 'exact', head: true })
      .eq('contract_id', aData.contractId);

    const { error } = await B.client.rpc('persist_key_terms', {
      p_contract_id: aData.contractId,
      p_terms: [{ ...terms[0], term_name: 'Planted By B' }],
      p_detected_type: 'MSA',
      p_type_mismatch: true,
      p_first_term_ready_ms: 1,
    });
    expect(error).not.toBeNull();
    expect(error?.message).toMatch(/NOT_FOUND/i);

    const { count: after } = await A.client
      .from('key_terms')
      .select('id', { count: 'exact', head: true })
      .eq('contract_id', aData.contractId);
    expect(after).toBe(before);

    const { data: planted } = await A.client
      .from('key_terms')
      .select('id')
      .eq('term_name', 'Planted By B');
    expect(planted ?? []).toHaveLength(0);
  });
});

describe('4. system_status is readable but not writable', () => {
  it('A can SELECT the row', async () => {
    const { data, error } = await A.client.from('system_status').select('level, message').single();
    expect(error).toBeNull();
    expect(data?.level).toBeDefined();
  });

  it('A cannot UPDATE it', async () => {
    const { data } = await A.client
      .from('system_status')
      .update({ level: 'p0', message: 'fake outage' })
      .eq('id', true)
      .select('id');
    expect(data ?? []).toHaveLength(0);

    const { data: check } = await adminClient()
      .from('system_status')
      .select('level')
      .single();
    expect(check?.level).not.toBe('p0');
  });

  it('an anonymous client cannot SELECT it', async () => {
    const { data, error } = await anonClient().from('system_status').select('level');
    expect(error !== null || (data ?? []).length === 0).toBe(true);
  });
});

describe('5. term_corrections shows only the caller\'s own corrections', () => {
  // Self-contained: `persist_key_terms` in 3b deletes and replaces the
  // contract's terms by design, clearing the seed's is_edited flag. The view is
  // driven by is_edited, so this edits a term here rather than relying on
  // earlier state.
  beforeAll(async () => {
    const { data: term } = await A.client
      .from('key_terms')
      .select('id')
      .eq('contract_id', aData.contractId)
      .limit(1)
      .single();

    await A.client
      .from('key_terms')
      .update({ value: 'Corrected value', is_edited: true, edited_at: new Date().toISOString() })
      .eq('id', term!.id);
  }, 60_000);

  it('A sees A\'s edited term', async () => {
    const { data, error } = await A.client.from('term_corrections').select('*');
    expect(error).toBeNull();
    expect((data ?? []).length).toBeGreaterThan(0);
    expect((data ?? []).every((row) => row.user_id === A.id)).toBe(true);
  });

  it('B sees nothing', async () => {
    const { data } = await B.client.from('term_corrections').select('*');
    expect(data ?? []).toHaveLength(0);
  });
});

describe('6. Storage policies isolate the per-user prefix', () => {
  it("B cannot upload into A's prefix", async () => {
    const { error } = await B.client.storage
      .from('contracts')
      .upload(`${A.id}/planted/evil.pdf`, TINY_PDF, { contentType: 'application/pdf' });
    expect(error).not.toBeNull();
  });

  it("B cannot list A's prefix", async () => {
    const { data } = await B.client.storage.from('contracts').list(A.id);
    expect(data ?? []).toHaveLength(0);
  });

  it("B cannot download A's object", async () => {
    const { data, error } = await B.client.storage.from('contracts').download(aData.storagePath);
    expect(error !== null || data === null).toBe(true);
  });

  it("B cannot create a signed URL for A's object", async () => {
    const { data, error } = await B.client.storage
      .from('contracts')
      .createSignedUrl(aData.storagePath, 60);
    expect(error !== null || data === null).toBe(true);
  });

  it("B cannot delete A's object", async () => {
    await B.client.storage.from('contracts').remove([aData.storagePath]);
    // A's object survives.
    const { data } = await A.client.storage.from('contracts').download(aData.storagePath);
    expect(data).not.toBeNull();
  });

  it('A can still read its own object', async () => {
    const { data, error } = await A.client.storage.from('contracts').download(aData.storagePath);
    expect(error).toBeNull();
    expect(data).not.toBeNull();
  });
});

describe('7. Signed URLs expire', () => {
  // A 1-second TTL races its own verification: the immediate fetch can land
  // after expiry and fail for the right reason at the wrong moment. A 3-second
  // TTL leaves room to prove the URL works BEFORE proving it stops working,
  // which is what the test is actually asserting.
  it('a short-lived URL works, then is rejected after it lapses', async () => {
    const { data } = await A.client.storage
      .from('contracts')
      .createSignedUrl(aData.storagePath, 3);
    expect(data?.signedUrl).toBeTruthy();

    const immediate = await fetch(data!.signedUrl);
    expect(immediate.status).toBe(200);

    await new Promise((resolve) => setTimeout(resolve, 6_000));
    const later = await fetch(data!.signedUrl);
    expect(later.status).toBeGreaterThanOrEqual(400);
  }, 30_000);
});

describe('8. Deleting a contract cascades every child table', () => {
  it('removes key_terms, custom_key_terms, chat, feedback and telemetry', async () => {
    const seeded = await seedContract(A);

    const { error } = await A.client.from('contracts').delete().eq('id', seeded.contractId);
    expect(error).toBeNull();

    for (const table of [
      'key_terms',
      'custom_key_terms',
      'chat_sessions',
      'user_feedback',
      'processing_runs',
      'openai_calls',
    ] as const) {
      const { data } = await A.client.from(table).select('id').eq('contract_id', seeded.contractId);
      expect(data ?? [], `${table} should be empty after cascade`).toHaveLength(0);
    }

    const { data: messages } = await A.client
      .from('chat_messages')
      .select('id')
      .eq('session_id', seeded.sessionId);
    expect(messages ?? []).toHaveLength(0);
  }, 60_000);
});

describe('9. The custom-term cap holds against a direct client insert', () => {
  it('a 6th term is refused by the trigger, bypassing the API entirely', async () => {
    // One already exists from the seed; add four more to reach the cap.
    for (const name of ['Cap term 2', 'Cap term 3', 'Cap term 4', 'Cap term 5']) {
      const { error } = await A.client
        .from('custom_key_terms')
        .insert({ contract_id: aData.contractId, user_id: A.id, term_name: name });
      expect(error, `inserting ${name} should succeed`).toBeNull();
    }

    const { error: sixth } = await A.client
      .from('custom_key_terms')
      .insert({ contract_id: aData.contractId, user_id: A.id, term_name: 'Cap term 6' });

    expect(sixth).not.toBeNull();
    expect(sixth?.message).toMatch(/CUSTOM_TERM_LIMIT/);

    const { count } = await A.client
      .from('custom_key_terms')
      .select('id', { count: 'exact', head: true })
      .eq('contract_id', aData.contractId);
    expect(count).toBe(5);
  }, 60_000);
});

describe('10. Sign-up creates exactly one profile via the trigger', () => {
  it('plan is free_trial and the trial ends ~14 days out', async () => {
    const { data, error } = await A.client
      .from('profiles')
      .select('id, email, plan, trial_ends_at, analyses_used');
    expect(error).toBeNull();
    expect(data ?? []).toHaveLength(1);

    const profile = data![0]!;
    expect(profile.id).toBe(A.id);
    expect(profile.plan).toBe('free_trial');
    expect(profile.analyses_used).toBe(0);

    const days = (new Date(profile.trial_ends_at!).getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(13.9);
    expect(days).toBeLessThan(14.1);
  });

  it('B cannot see A\'s profile', async () => {
    const { data } = await B.client.from('profiles').select('id').eq('id', A.id);
    expect(data ?? []).toHaveLength(0);
  });

  it('A cannot UPDATE another user\'s profile', async () => {
    const { data } = await A.client
      .from('profiles')
      .update({ plan: 'pro' })
      .eq('id', B.id)
      .select('id');
    expect(data ?? []).toHaveLength(0);
  });
});
