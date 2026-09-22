import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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
import { SHORT_NDA, makePdf } from './pdf-fixtures';

/**
 * Spec 06 v1.1 §E — summary (US-015, D45), key-date derivation (step 11c,
 * spec 21 §7.2) and the D47 c batching cases. Every test owns its contract.
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

const GOOD_SUMMARY = [
  'This is a mutual non-disclosure agreement between Harborlight Robotics and a counterparty. [Page 1]',
  '',
  '**Obligations of Harborlight Robotics:**',
  '- Keep the other side\'s information confidential for 2 years. [Page 1]',
  '- Disputes are governed by the law of the State of Delaware. [Page 1]',
].join('\n');

const MSA_TEXT = [
  'MASTER SERVICES AGREEMENT',
  'This Master Services Agreement is made effective as of 2026-04-01 between Fabrikam Consulting LLC ("Supplier") and Tailspin Retail Group plc ("Client").',
  'The initial term of this Agreement ends on 2027-03-31. The Agreement automatically renews for successive twelve (12) month periods unless either party gives written notice of non-renewal at least thirty (30) days before the end of the then-current term.',
  'Client shall pay each undisputed invoice within thirty (30) days of receipt. Invoices are issued monthly in arrears. Amounts not paid when due accrue interest at 1.5% per month.',
  'Each party\'s aggregate liability shall not exceed the fees paid in the twelve months preceding the claim. This Agreement is governed by the laws of the State of New York.',
  'The parties shall keep each other\'s confidential information secret and use it only to perform this Agreement. Either party may terminate for material breach on thirty (30) days written notice if the breach is not cured.',
].join('\n\n');
const MSA_PDF = makePdf(MSA_TEXT);

function msaExtraction(overrides: { withNotice?: boolean; detectedType?: 'MSA' | 'NDA' } = {}) {
  const withNotice = overrides.withNotice ?? true;
  return JSON.stringify({
    detected_type: overrides.detectedType ?? 'MSA',
    terms: [
      { term_name: 'Service Provider Name', value: 'Fabrikam Consulting LLC', page_number: 1, confidence_score: 0.95, source_anchor: 'Fabrikam Consulting LLC ("Supplier")', reasoning: 'Supplier.' },
      { term_name: 'Customer Name', value: 'Tailspin Retail Group plc', page_number: 1, confidence_score: 0.95, source_anchor: 'Tailspin Retail Group plc ("Client")', reasoning: 'Client.' },
      { term_name: 'Contract start date', value: '2026-04-01', page_number: 1, confidence_score: 0.9, source_anchor: 'made effective as of 2026-04-01', reasoning: 'Effective date.' },
      { term_name: 'Contract end date', value: '2027-03-31', page_number: 1, confidence_score: 0.9, source_anchor: 'ends on 2027-03-31', reasoning: 'End of initial term.' },
      { term_name: 'Auto Renewal', value: 'Yes', page_number: 1, confidence_score: 0.9, source_anchor: 'automatically renews for successive twelve (12) month periods', reasoning: 'Auto-renews.' },
      { term_name: 'Renewal Period (Months)', value: '12', page_number: 1, confidence_score: 0.9, source_anchor: 'successive twelve (12) month periods', reasoning: 'Twelve months.' },
      ...(withNotice
        ? [{ term_name: 'Notice to not auto renew (Days)', value: '30', page_number: 1, confidence_score: 0.9, source_anchor: 'at least thirty (30) days before the end', reasoning: 'Thirty days.' }]
        : []),
    ],
  });
}

async function fresh(pdf: Buffer, type: 'NDA' | 'MSA'): Promise<string> {
  const res = await uploadPdf(user, pdf, type);
  expect(res.status).toBe(201);
  return res.body.contract_id;
}

async function process(id: string) {
  return api<{ status: string; summary_status: string; summary_md?: string; term_count: number }>(
    user,
    `/api/contracts/${id}/process`,
    { method: 'POST' },
  );
}

beforeAll(async () => {
  await startApp();
  user = await createUser('summary');
  await setPlan(user, 'pro');
}, 180_000);

afterAll(async () => {
  await destroyUser(user);
  await stopApp();
}, 120_000);

describe('summary at process time (step 11a)', () => {
  it('a completed process yields summary_status=completed, ≤ 220 words, every factual sentence cited, within $0.05', async () => {
    resetOpenAiStub();
    scriptOpenAi({ content: NDA_EXTRACTION }, { content: GOOD_SUMMARY });
    const id = await fresh(SHORT_NDA, 'NDA');
    const res = await process(id);
    expect(res.status).toBe(200);
    expect(res.body.summary_status).toBe('completed');
    expect(res.body.summary_md).toContain('[Page 1]');

    const { data } = await user.client
      .from('contracts')
      .select('summary_md, summary_status, summary_uncited, summary_generated_ms')
      .eq('id', id)
      .single();
    expect(data?.summary_status).toBe('completed');
    expect(data?.summary_uncited).toBe(false);
    expect((data?.summary_md as string).trim().split(/\s+/).length).toBeLessThanOrEqual(220);
    expect(data?.summary_generated_ms).toBeGreaterThan(0);

    const { data: calls } = await user.client.from('openai_calls').select('purpose, cost_usd').eq('contract_id', id);
    const summaryCalls = (calls ?? []).filter((c) => c.purpose === 'summary');
    expect(summaryCalls).toHaveLength(1);
    expect(Number(summaryCalls[0]!.cost_usd)).toBeLessThanOrEqual(0.05);

    const { data: runs } = await user.client.from('processing_runs').select('stage, outcome').eq('contract_id', id);
    expect((runs ?? []).some((r) => r.stage === 'summary' && r.outcome === 'success')).toBe(true);
  });

  it('an uncited summary triggers one repair call and is stored with summary_uncited=true', async () => {
    resetOpenAiStub();
    // The extraction JSON repeats as the "summary": factual (digits) and uncited, twice.
    scriptOpenAi({ content: NDA_EXTRACTION });
    const id = await fresh(SHORT_NDA, 'NDA');
    const res = await process(id);
    expect(res.status).toBe(200);
    expect(res.body.summary_status).toBe('completed');
    const { data } = await user.client.from('contracts').select('summary_uncited').eq('id', id).single();
    expect(data?.summary_uncited).toBe(true);
    const { data: calls } = await user.client.from('openai_calls').select('purpose').eq('contract_id', id);
    expect((calls ?? []).filter((c) => c.purpose === 'summary')).toHaveLength(2);
  });

  it('a repair-call timeout keeps the first draft: summary_status=completed, summary_uncited=true, no error code', async () => {
    resetOpenAiStub();
    // Extraction, then an uncited first draft, then a repair call that exceeds the 10 s summary timeout.
    scriptOpenAi({ content: NDA_EXTRACTION }, { content: NDA_EXTRACTION }, { content: GOOD_SUMMARY, delayMs: 12_000 });
    const id = await fresh(SHORT_NDA, 'NDA');
    const res = await process(id);
    expect(res.status).toBe(200);
    expect(res.body.summary_status).toBe('completed');

    const { data } = await user.client
      .from('contracts')
      .select('summary_md, summary_status, summary_uncited, summary_error_code')
      .eq('id', id)
      .single();
    expect(data?.summary_status).toBe('completed');
    expect(data?.summary_uncited).toBe(true);
    expect(data?.summary_error_code).toBeNull();
    expect(data?.summary_md).toBeTruthy();

    const { data: calls } = await user.client
      .from('openai_calls')
      .select('purpose, outcome')
      .eq('contract_id', id)
      .order('created_at', { ascending: true });
    const summaryCalls = (calls ?? []).filter((c) => c.purpose === 'summary');
    expect(summaryCalls.map((c) => c.outcome)).toEqual(['success', 'timeout']);
  }, 90_000);

  it('a summary timeout leaves the terms committed with summary_status=error; POST /summary completes it once, then 409', async () => {
    resetOpenAiStub();
    scriptOpenAi({ content: NDA_EXTRACTION }, { content: GOOD_SUMMARY, delayMs: 12_000 });
    const id = await fresh(SHORT_NDA, 'NDA');
    const res = await process(id);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('completed');
    expect(res.body.summary_status).toBe('error');

    const { count } = await user.client.from('key_terms').select('id', { count: 'exact', head: true }).eq('contract_id', id);
    expect(count).toBe(10);
    const { data: before } = await user.client.from('contracts').select('summary_status, summary_error_code').eq('id', id).single();
    expect(before?.summary_status).toBe('error');
    expect(before?.summary_error_code).toBe('AI_TIMEOUT');

    resetOpenAiStub();
    scriptOpenAi({ content: GOOD_SUMMARY });
    const retry = await api<{ summary_status: string; summary_md: string }>(user, `/api/contracts/${id}/summary`, { method: 'POST' });
    expect(retry.status).toBe(200);
    expect(retry.body.summary_status).toBe('completed');

    const again = await api<{ error: { code: string } }>(user, `/api/contracts/${id}/summary`, { method: 'POST' });
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('SUMMARY_NOT_PENDING');
  }, 90_000);

  it('a fresh processing claim is 409; a 3-minute-old claim is stale and re-claimable', async () => {
    resetOpenAiStub();
    scriptOpenAi({ content: NDA_EXTRACTION }, { content: GOOD_SUMMARY });
    const id = await fresh(SHORT_NDA, 'NDA');
    await process(id);

    // 30 s old: fresh — GET says not stale, POST is refused, no summary call made.
    await admin().from('contracts').update({ summary_status: 'processing', summary_claimed_at: new Date(Date.now() - 30_000).toISOString() }).eq('id', id);
    const freshGet = await api<{ contract: { summary_claim_stale: boolean } }>(user, `/api/contracts/${id}`);
    expect(freshGet.body.contract.summary_claim_stale).toBe(false);
    const { data: callsBefore } = await user.client.from('openai_calls').select('id').eq('contract_id', id).eq('purpose', 'summary');
    const refused = await api<{ error: { code: string } }>(user, `/api/contracts/${id}/summary`, { method: 'POST' });
    expect(refused.status).toBe(409);
    expect(refused.body.error.code).toBe('SUMMARY_NOT_PENDING');
    const { data: callsAfter } = await user.client.from('openai_calls').select('id').eq('contract_id', id).eq('purpose', 'summary');
    expect(callsAfter?.length).toBe(callsBefore?.length);

    // 3 min old: stale — GET says so, POST re-claims and completes.
    await admin().from('contracts').update({ summary_status: 'processing', summary_claimed_at: new Date(Date.now() - 3 * 60_000).toISOString() }).eq('id', id);
    const staleGet = await api<{ contract: { summary_claim_stale: boolean } }>(user, `/api/contracts/${id}`);
    expect(staleGet.body.contract.summary_claim_stale).toBe(true);
    const reclaimed = await api<{ summary_status: string }>(user, `/api/contracts/${id}/summary`, { method: 'POST' });
    expect(reclaimed.status).toBe(200);
    expect(reclaimed.body.summary_status).toBe('completed');
  });

  it('POST /summary on an unprocessed contract is 409 NOT_PROCESSED and makes no call', async () => {
    resetOpenAiStub();
    scriptOpenAi({ content: GOOD_SUMMARY });
    const id = await fresh(SHORT_NDA, 'NDA');
    const res = await api<{ error: { code: string } }>(user, `/api/contracts/${id}/summary`, { method: 'POST' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('NOT_PROCESSED');
    const { count } = await user.client.from('openai_calls').select('id', { count: 'exact', head: true }).eq('contract_id', id);
    expect(count).toBe(0);
  });
});

describe('D47 c — parallel batches', () => {
  it('a 36-term MSA yields exactly two extraction calls and one persist', async () => {
    resetOpenAiStub();
    scriptOpenAi({ content: msaExtraction() });
    const id = await fresh(MSA_PDF, 'MSA');
    const res = await process(id);
    expect(res.status).toBe(200);
    expect(res.body.term_count).toBe(36);

    const { data: calls } = await user.client.from('openai_calls').select('purpose').eq('contract_id', id);
    expect((calls ?? []).filter((c) => c.purpose === 'extraction')).toHaveLength(2);
    const { data: runs } = await user.client.from('processing_runs').select('stage').eq('contract_id', id);
    expect((runs ?? []).filter((r) => r.stage === 'persist')).toHaveLength(1);
    expect((runs ?? []).filter((r) => r.stage === 'ai_extract')).toHaveLength(1);

    // Both batch prompts carried their own share of the 36 terms.
    const extractionRequests = openAiRequests().filter((r) =>
      (r.messages as Array<{ role: string; content: string }>).some((m) => m.role === 'system' && /Extract these MSA terms/.test(m.content)),
    );
    expect(extractionRequests).toHaveLength(2);
  });

  it('a detected_type disagreement between batches is logged and batch order decides', async () => {
    resetOpenAiStub();
    scriptOpenAi({ content: msaExtraction({ detectedType: 'MSA' }) }, { content: msaExtraction({ detectedType: 'NDA' }) });
    const id = await fresh(MSA_PDF, 'MSA');
    const res = await process(id);
    expect(res.status).toBe(200);
    const { data: events } = await user.client
      .from('activity_events')
      .select('event_type, metadata')
      .eq('contract_id', id)
      .eq('event_type', 'extraction_type_disagreement');
    expect(events).toHaveLength(1);
    expect(String((events![0]!.metadata as { detected_types: string }).detected_types)).toMatch(/MSA|NDA/);
  });
});

describe('key dates (step 11c, spec 21 §7.2)', () => {
  it('a processed MSA with the four source terms has three key_dates and 18 reminders, with no edit', async () => {
    resetOpenAiStub();
    scriptOpenAi({ content: msaExtraction() });
    const id = await fresh(MSA_PDF, 'MSA');
    await process(id);

    const { data: dates } = await user.client.from('key_dates').select('kind, date').eq('contract_id', id).order('date');
    expect((dates ?? []).map((d) => [d.kind, d.date])).toEqual([
      ['renewal_notice_deadline', '2027-03-01'],
      ['end_date', '2027-03-31'],
      ['renewal_date', '2028-03-31'],
    ]);
    const kd = (await api<{ key_dates: Array<{ kind: string; reminders: unknown[] }> }>(user, `/api/contracts/${id}/key-dates`)).body;
    expect(kd.key_dates).toHaveLength(3);
    expect(kd.key_dates.reduce((n, d) => n + d.reminders.length, 0)).toBe(18);
  });

  it('without the notice term: end_date, renewal_date, auto_renewal_check', async () => {
    resetOpenAiStub();
    scriptOpenAi({ content: msaExtraction({ withNotice: false }) });
    const id = await fresh(MSA_PDF, 'MSA');
    await process(id);
    const { data: dates } = await user.client.from('key_dates').select('kind').eq('contract_id', id);
    expect((dates ?? []).map((d) => d.kind).sort()).toEqual(['auto_renewal_check', 'end_date', 'renewal_date']);
  });

  it('route 30 replaces offsets and rejects 45; editing Contract end date re-derives', async () => {
    resetOpenAiStub();
    scriptOpenAi({ content: msaExtraction() });
    const id = await fresh(MSA_PDF, 'MSA');
    await process(id);
    const { data: end } = await user.client.from('key_dates').select('id').eq('contract_id', id).eq('kind', 'end_date').single();

    const bad = await api<{ error: { code: string } }>(user, `/api/key-dates/${end!.id}/reminders`, { method: 'PATCH', body: JSON.stringify({ offsets_days: [45] }) });
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('INVALID_OFFSETS');

    const ok = await api<{ reminders: Array<{ offset_days: number }> }>(user, `/api/key-dates/${end!.id}/reminders`, { method: 'PATCH', body: JSON.stringify({ offsets_days: [30] }) });
    expect(ok.status).toBe(200);
    expect(ok.body.reminders.map((r) => r.offset_days)).toEqual([30, 30]);

    const { data: term } = await user.client.from('key_terms').select('id').eq('contract_id', id).eq('term_name', 'Contract end date').single();
    const edit = await api(user, `/api/key-terms/${term!.id}`, { method: 'PATCH', body: JSON.stringify({ value: '2028-01-31' }) });
    expect(edit.status).toBe(200);
    const { data: after } = await user.client.from('key_dates').select('kind, date').eq('contract_id', id).eq('kind', 'end_date').single();
    expect(after?.date).toBe('2028-01-31');
  });
});
