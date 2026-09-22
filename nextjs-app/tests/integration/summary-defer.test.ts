import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  api,
  createUser,
  destroyUser,
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
 * Stage 5a — step 11a deferral (spec 06 v1.1 §B). Own app: the extraction
 * must be allowed to take 14 s, longer than the default 4 s harness timeout.
 */

let user: TestUser;

const NDA_EXTRACTION = JSON.stringify({
  detected_type: 'NDA',
  terms: [
    {
      term_name: 'Governing Law',
      value: 'State of Delaware',
      page_number: 1,
      confidence_score: 0.95,
      source_anchor: 'governed by the laws of the State of Delaware',
      reasoning: 'The governing-law clause names Delaware.',
    },
  ],
});

const GOOD_SUMMARY =
  'This is a mutual non-disclosure agreement between Harborlight Robotics and a counterparty. [Page 1]';

beforeAll(async () => {
  await startApp({ OPENAI_TIMEOUT_MS: '20000', OPENAI_MAX_RETRIES: '1' });
  user = await createUser('summarydefer');
  await setPlan(user, 'pro');
}, 180_000);

afterAll(async () => {
  await destroyUser(user);
  await stopApp();
}, 120_000);

describe('step 11a deferral', () => {
  it('an extraction consuming 14 s leaves summary_status=pending (not error) and makes no summary call; route 34 then completes it', async () => {
    resetOpenAiStub();
    scriptOpenAi({ content: NDA_EXTRACTION, delayMs: 14_000 }, { content: GOOD_SUMMARY });
    const up = await uploadPdf(user, SHORT_NDA, 'NDA');
    expect(up.status).toBe(201);
    const id = up.body.contract_id;

    const res = await api<{ status: string; summary_status: string }>(user, `/api/contracts/${id}/process`, { method: 'POST' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('completed');
    expect(res.body.summary_status).toBe('pending');

    const { data } = await user.client.from('contracts').select('summary_status, summary_error_code').eq('id', id).single();
    expect(data?.summary_status).toBe('pending');
    expect(data?.summary_error_code).toBeNull();

    const { data: calls } = await user.client.from('openai_calls').select('purpose').eq('contract_id', id);
    expect((calls ?? []).filter((c) => c.purpose === 'summary')).toHaveLength(0);

    const { data: events } = await user.client
      .from('activity_events')
      .select('event_type')
      .eq('contract_id', id)
      .eq('event_type', 'summary_deferred');
    expect(events).toHaveLength(1);

    const deferred = await api<{ summary_status: string; summary_md: string }>(user, `/api/contracts/${id}/summary`, { method: 'POST' });
    expect(deferred.status).toBe(200);
    expect(deferred.body.summary_status).toBe('completed');
    expect(deferred.body.summary_md).toContain('[Page 1]');
  }, 90_000);
});
