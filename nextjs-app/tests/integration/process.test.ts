import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  admin,
  api,
  createUser,
  destroyUser,
  openAiRequests,
  resetOpenAiStub,
  scriptOpenAi,
  setPlan,
  startApp,
  stopApp,
  uploadPdf,
  type TestUser,
} from './harness';
import { SHORT_NDA } from './pdf-fixtures';

/**
 * Spec 06 §9 — the extraction pipeline against a stubbed model.
 *
 * FIXTURE RULE (spec 02 §8): `persist_key_terms` REPLACES a contract's terms,
 * so every test here uploads its own contract and owns its own state.
 */

let user: TestUser;

function goodExtraction(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    detected_type: 'NDA',
    terms: [
      {
        term_name: 'Governing Law',
        value: 'Laws of the State of Delaware',
        page_number: 1,
        confidence_score: 0.95,
        source_sentence: 'This Agreement is governed by the laws of the State of Delaware.',
      },
      {
        term_name: 'Effective Date',
        value: '11 February 2025',
        page_number: 1,
        confidence_score: 0.92,
        source_sentence: 'This Mutual Non-Disclosure Agreement is entered into as of 11 February 2025',
      },
      ...(((overrides.extraTerms as unknown[]) ?? []) as unknown[]),
    ],
    ...overrides,
  });
}

async function freshContract(): Promise<string> {
  const res = await uploadPdf(user, SHORT_NDA, 'NDA');
  expect(res.status).toBe(201);
  return res.body.contract_id;
}

beforeAll(async () => {
  await startApp();
  user = await createUser('process');
  // Each test owns its own contract, which is more than the free trial's 5
  // analyses allows. The counter is deletion-proof by design, so cleanup cannot
  // reclaim units — the plan has to be unlimited.
  await setPlan(user, 'pro');
}, 180_000);

afterAll(async () => {
  await destroyUser(user);
  await stopApp();
}, 120_000);

beforeEach(() => {
  resetOpenAiStub();
  scriptOpenAi({ content: goodExtraction() });
});

describe('POST /api/contracts/{id}/process — happy path', () => {
  it('completes, returns the full requested term set, and clears processing_started_at', async () => {
    const id = await freshContract();
    const res = await api<{
      status: string;
      detected_type: string;
      term_count: number;
      terms: Array<{ term_name: string; confidence_score: number; is_source_verified: boolean }>;
    }>(user, `/api/contracts/${id}/process`, { method: 'POST' });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('completed');
    expect(res.body.detected_type).toBe('NDA');
    // All 10 NDA terms come back, including the ones the model did not return.
    expect(res.body.term_count).toBe(10);

    const { data } = await user.client
      .from('contracts')
      .select('status, processing_started_at, processed_at, first_term_ready_ms')
      .eq('id', id)
      .single();
    expect(data?.status).toBe('completed');
    expect(data?.processing_started_at).toBeNull();
    expect(data?.processed_at).not.toBeNull();
    expect(data?.first_term_ready_ms).toBeGreaterThan(0);
  });

  it('converts confidence 0-1 to an integer 0-100 exactly once', async () => {
    const id = await freshContract();
    await api(user, `/api/contracts/${id}/process`, { method: 'POST' });

    const { data } = await user.client
      .from('key_terms')
      .select('term_name, confidence_score')
      .eq('contract_id', id)
      .eq('term_name', 'Governing Law')
      .single();
    expect(data?.confidence_score).toBe(95);
  });

  it('inserts a requested term the model omitted at 0% with a null value', async () => {
    const id = await freshContract();
    await api(user, `/api/contracts/${id}/process`, { method: 'POST' });

    const { data } = await user.client
      .from('key_terms')
      .select('value, confidence_score, page_number')
      .eq('contract_id', id)
      .eq('term_name', 'Non-Solicitation')
      .single();

    expect(data?.value).toBeNull();
    expect(data?.confidence_score).toBe(0);
    expect(data?.page_number).toBeNull();
  });

  it('captures original_ai_value at insert', async () => {
    const id = await freshContract();
    await api(user, `/api/contracts/${id}/process`, { method: 'POST' });

    const { data } = await user.client
      .from('key_terms')
      .select('value, original_ai_value')
      .eq('contract_id', id)
      .eq('term_name', 'Governing Law')
      .single();
    expect(data?.original_ai_value).toBe(data?.value);
  });

  it('writes one openai_calls row and the ai_extract/persist/total timings', async () => {
    const id = await freshContract();
    await api(user, `/api/contracts/${id}/process`, { method: 'POST' });

    const { data: calls } = await user.client
      .from('openai_calls')
      .select('purpose, outcome, attempt')
      .eq('contract_id', id);
    expect(calls ?? []).toHaveLength(1);
    expect(calls![0]!.outcome).toBe('success');

    const { data: runs } = await user.client
      .from('processing_runs')
      .select('stage')
      .eq('contract_id', id);
    const stages = (runs ?? []).map((r) => r.stage).sort();
    expect(stages).toEqual(['ai_extract', 'persist', 'text_extract', 'total', 'upload']);
  });
});

describe('grounding and confidence capping', () => {
  it('caps an unverifiable source sentence into the low band', async () => {
    resetOpenAiStub();
    scriptOpenAi({
      content: JSON.stringify({
        detected_type: 'NDA',
        terms: [
          {
            term_name: 'Governing Law',
            value: 'Laws of Mars',
            page_number: 1,
            confidence_score: 0.99,
            source_sentence: 'This sentence does not appear anywhere in the document.',
          },
        ],
      }),
    });

    const id = await freshContract();
    await api(user, `/api/contracts/${id}/process`, { method: 'POST' });

    const { data } = await user.client
      .from('key_terms')
      .select('confidence_score, is_source_verified')
      .eq('contract_id', id)
      .eq('term_name', 'Governing Law')
      .single();

    expect(data?.is_source_verified).toBe(false);
    // 49, not 50 — it must land in the red band that triggers the warning.
    expect(data?.confidence_score).toBe(49);
  });

  it('nulls an out-of-range page and caps confidence', async () => {
    resetOpenAiStub();
    scriptOpenAi({
      content: JSON.stringify({
        detected_type: 'NDA',
        terms: [
          {
            term_name: 'Governing Law',
            value: 'Delaware',
            page_number: 99,
            confidence_score: 0.98,
            source_sentence: 'This Agreement is governed by the laws of the State of Delaware.',
          },
        ],
      }),
    });

    const id = await freshContract();
    await api(user, `/api/contracts/${id}/process`, { method: 'POST' });

    const { data } = await user.client
      .from('key_terms')
      .select('page_number, confidence_score')
      .eq('contract_id', id)
      .eq('term_name', 'Governing Law')
      .single();

    expect(data?.page_number).toBeNull();
    expect(data?.confidence_score).toBeLessThanOrEqual(49);
  });

  it('normalises a "not found" value to null at 0%', async () => {
    resetOpenAiStub();
    scriptOpenAi({
      content: JSON.stringify({
        detected_type: 'NDA',
        terms: [
          {
            term_name: 'Governing Law',
            value: 'N/A',
            page_number: 1,
            confidence_score: 0.4,
            source_sentence: null,
          },
        ],
      }),
    });

    const id = await freshContract();
    await api(user, `/api/contracts/${id}/process`, { method: 'POST' });

    const { data } = await user.client
      .from('key_terms')
      .select('value, confidence_score')
      .eq('contract_id', id)
      .eq('term_name', 'Governing Law')
      .single();

    expect(data?.value).toBeNull();
    expect(data?.confidence_score).toBe(0);
  });

  it('flags a type mismatch without failing the run', async () => {
    resetOpenAiStub();
    scriptOpenAi({ content: goodExtraction({ detected_type: 'MSA' }) });

    const id = await freshContract();
    const res = await api<{ type_mismatch_warning: boolean; status: string }>(
      user,
      `/api/contracts/${id}/process`,
      { method: 'POST' },
    );

    expect(res.body.status).toBe('completed');
    expect(res.body.type_mismatch_warning).toBe(true);
  });
});

describe('failure paths leave a retryable error and no partial terms', () => {
  it('invalid JSON twice yields AI_INVALID_OUTPUT with zero key_terms', async () => {
    resetOpenAiStub();
    scriptOpenAi({ content: 'this is not json' }, { content: 'still not json' });

    const id = await freshContract();
    const res = await api<{ error: { code: string } }>(user, `/api/contracts/${id}/process`, {
      method: 'POST',
    });

    expect(res.status).toBe(502);
    expect(res.body.error.code).toBe('AI_INVALID_OUTPUT');

    const { data: contract } = await user.client
      .from('contracts')
      .select('status, error_code')
      .eq('id', id)
      .single();
    expect(contract?.status).toBe('error');
    expect(contract?.error_code).toBe('AI_INVALID_OUTPUT');

    const { count } = await user.client
      .from('key_terms')
      .select('id', { count: 'exact', head: true })
      .eq('contract_id', id);
    expect(count).toBe(0);
  }, 60_000);

  it('a JSON-repair retry rescues a single bad response', async () => {
    resetOpenAiStub();
    scriptOpenAi({ content: 'not json at all' }, { content: goodExtraction() });

    const id = await freshContract();
    const res = await api<{ status: string }>(user, `/api/contracts/${id}/process`, {
      method: 'POST',
    });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('completed');

    // The repair call is logged separately and is not counted against the 3.
    const { data: calls } = await user.client
      .from('openai_calls')
      .select('purpose')
      .eq('contract_id', id);
    const purposes = (calls ?? []).map((c) => c.purpose).sort();
    expect(purposes).toEqual(['extraction', 'repair']);
  }, 60_000);

  it('a 500 from the provider persists status=error and returns a retryable code', async () => {
    resetOpenAiStub();
    scriptOpenAi({ content: '', status: 500 });

    const id = await freshContract();
    const res = await api<{ error: { code: string; retryable: boolean } }>(
      user,
      `/api/contracts/${id}/process`,
      { method: 'POST' },
    );

    expect([503, 504]).toContain(res.status);
    expect(res.body.error.retryable).toBe(true);

    const { data } = await user.client
      .from('contracts')
      .select('status, error_message')
      .eq('id', id)
      .single();
    expect(data?.status).toBe('error');
    expect(data?.error_message).toMatch(/couldn't reach the AI service/);
  }, 60_000);

  it('retrying after an error succeeds without re-uploading', async () => {
    resetOpenAiStub();
    scriptOpenAi({ content: '', status: 500 });

    const id = await freshContract();
    const failed = await api(user, `/api/contracts/${id}/process`, { method: 'POST' });
    expect(failed.status).toBeGreaterThanOrEqual(500);

    resetOpenAiStub();
    scriptOpenAi({ content: goodExtraction() });

    const retried = await api<{ status: string }>(user, `/api/contracts/${id}/process`, {
      method: 'POST',
    });
    expect(retried.status).toBe(200);
    expect(retried.body.status).toBe('completed');
  }, 90_000);
});

describe('status guards', () => {
  it('409 ALREADY_PROCESSED on a completed contract', async () => {
    const id = await freshContract();
    await api(user, `/api/contracts/${id}/process`, { method: 'POST' });

    const again = await api<{ error: { code: string } }>(user, `/api/contracts/${id}/process`, {
      method: 'POST',
    });
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('ALREADY_PROCESSED');
  });

  it('409 ALREADY_PROCESSING on a fresh in-flight run', async () => {
    const id = await freshContract();
    await admin()
      .from('contracts')
      .update({ status: 'processing', processing_started_at: new Date().toISOString() })
      .eq('id', id);

    const res = await api<{ error: { code: string } }>(user, `/api/contracts/${id}/process`, {
      method: 'POST',
    });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('ALREADY_PROCESSING');
  });

  it('re-claims a stale run even while the 2s poll keeps bumping updated_at', async () => {
    const id = await freshContract();

    // The exact trap spec 06 §3a describes: the run is 6 minutes old, but the
    // results-page poll has just touched last_accessed_at (and so updated_at).
    await admin()
      .from('contracts')
      .update({
        status: 'processing',
        processing_started_at: new Date(Date.now() - 6 * 60_000).toISOString(),
      })
      .eq('id', id);
    await api(user, `/api/contracts/${id}`);

    const { data: before } = await admin()
      .from('contracts')
      .select('updated_at, processing_started_at')
      .eq('id', id)
      .single();
    const updatedAge = Date.now() - new Date(before!.updated_at as string).getTime();
    expect(updatedAge).toBeLessThan(10_000); // updated_at looks fresh…
    const runAge = Date.now() - new Date(before!.processing_started_at as string).getTime();
    expect(runAge).toBeGreaterThan(5 * 60_000); // …but the run is stale.

    const res = await api<{ status: string }>(user, `/api/contracts/${id}/process`, {
      method: 'POST',
    });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('completed');
  }, 90_000);

  it('404 for another user\'s contract id', async () => {
    const other = await createUser('processother');
    try {
      await setPlan(other, 'pro');
      const id = await freshContract();
      const res = await api<{ error: { code: string } }>(other, `/api/contracts/${id}/process`, {
        method: 'POST',
      });
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
    } finally {
      await destroyUser(other);
    }
  }, 90_000);
});

describe('the prompt sent to the model', () => {
  it('carries the few-shot block, the NDA term list and the document body', async () => {
    resetOpenAiStub();
    scriptOpenAi({ content: goodExtraction() });

    const id = await freshContract();
    await api(user, `/api/contracts/${id}/process`, { method: 'POST' });

    const requests = openAiRequests();
    expect(requests.length).toBeGreaterThan(0);
    const messages = requests.at(-1)!.messages as Array<{ role: string; content: string }>;

    const system = messages.find((m) => m.role === 'system')!.content;
    expect(system).toMatch(/Worked examples — NDA/);
    expect(system).toMatch(/Worked examples — MSA/);
    // v1.1: extraction.v2 renders each target as name + Question + Answer format.
    expect(system).toMatch(/- Governing Law\n  Question: /);
    expect(system).toMatch(/Never infer from general legal knowledge/);

    const userMessage = messages.find((m) => m.role === 'user')!.content;
    expect(userMessage).toMatch(/^\[PAGE 1\]/);
    expect(userMessage).toMatch(/Harborlight Robotics/);
  });
});
