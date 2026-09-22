import { createServer, type Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  admin,
  api,
  createUser,
  destroyUser,
  openAiStubUrl,
  resetOpenAiStub,
  scriptOpenAi,
  setPlan,
  startApp,
  stopApp,
  testEnv,
  uploadPdf,
  type TestUser,
} from './harness';
import { SHORT_NDA } from './pdf-fixtures';
import { PROCESS_JOB_SIGNATURE_HEADER, signProcessJob, verifyProcessJob } from '@/lib/security/process-job-signature';
import handler from '../../netlify/functions/process-background';

/**
 * Spec 06 v1.1 §G (D49 a) — pipeline.async.
 *
 * The app runs with PROCESS_JOB_SECRET set and PROCESS_JOB_URL pointed at a
 * local "invoker" that records the signed job and answers 202 the way Netlify
 * does for a background function. The background function itself is then
 * driven IN-PROCESS with the captured request, against the same OpenAI stub,
 * so the whole hand-off is exercised without a Netlify deploy.
 */

const SECRET = 'integration-process-job-secret';
let user: TestUser;
let invoker: Server;
let invokerUrl = '';
const captured: Array<{ body: string; signature: string | null }> = [];

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
const GOOD_SUMMARY = 'This is a mutual non-disclosure agreement between Harborlight Robotics and a counterparty. [Page 1]';

beforeAll(async () => {
  invoker = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      captured.push({ body, signature: (req.headers[PROCESS_JOB_SIGNATURE_HEADER] as string | undefined) ?? null });
      res.writeHead(202);
      res.end();
    });
  });
  await new Promise<void>((done) => invoker.listen(0, '127.0.0.1', () => done()));
  invokerUrl = `http://127.0.0.1:${(invoker.address() as { port: number }).port}/.netlify/functions/process-background`;

  await startApp({ PROCESS_JOB_SECRET: SECRET, PROCESS_JOB_URL: invokerUrl });

  // The in-process background function reads the same env the app does.
  Object.assign(process.env, testEnv(), {
    OPENAI_BASE_URL: openAiStubUrl(),
    PROCESS_JOB_SECRET: SECRET,
    OPENAI_MAX_RETRIES: '1',
    OPENAI_TIMEOUT_MS: '4000',
  });

  user = await createUser('async');
  await setPlan(user, 'pro');
}, 180_000);

afterAll(async () => {
  await destroyUser(user);
  await stopApp();
  await new Promise<void>((done) => invoker.close(() => done()));
}, 120_000);

async function fresh(): Promise<string> {
  const res = await uploadPdf(user, SHORT_NDA, 'NDA');
  expect(res.status).toBe(201);
  return res.body.contract_id;
}

function invoke(body: string, signature: string | null): Promise<Response> {
  return handler(
    new Request('http://localhost/.netlify/functions/process-background', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(signature ? { [PROCESS_JOB_SIGNATURE_HEADER]: signature } : {}) },
      body,
    }),
  );
}

describe('POST /process with PROCESS_JOB_SECRET set', () => {
  it('keeps the guards, claims the row, enqueues a signed job and returns 202 { status: processing }', async () => {
    resetOpenAiStub();
    scriptOpenAi({ content: NDA_EXTRACTION });
    const id = await fresh();
    captured.length = 0;

    const res = await api<{ contract_id: string; status: string }>(user, `/api/contracts/${id}/process`, { method: 'POST' });
    expect(res.status).toBe(202);
    expect(res.body).toEqual({ contract_id: id, status: 'processing' });

    const { data: row } = await user.client.from('contracts').select('status, processing_started_at').eq('id', id).single();
    expect(row?.status).toBe('processing');
    expect(row?.processing_started_at).toBeTruthy();

    // No model call happened in the route: the run belongs to the background function.
    const { count } = await user.client.from('openai_calls').select('id', { count: 'exact', head: true }).eq('contract_id', id);
    expect(count).toBe(0);

    expect(captured).toHaveLength(1);
    const job = captured[0]!;
    const verified = verifyProcessJob(job.body, job.signature, SECRET);
    expect(verified.ok).toBe(true);
    if (verified.ok) expect(verified.payload).toMatchObject({ contract_id: id, user_id: user.id });

    const { data: events } = await user.client.from('activity_events').select('event_type').eq('contract_id', id).order('created_at');
    expect((events ?? []).map((e) => e.event_type)).toEqual(expect.arrayContaining(['process_started', 'process_enqueued']));

    // A second POST while the claim is fresh is still 409.
    const again = await api<{ error: { code: string } }>(user, `/api/contracts/${id}/process`, { method: 'POST' });
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('ALREADY_PROCESSING');
  });

  it('a completed contract is still 409 ALREADY_PROCESSED and enqueues nothing', async () => {
    const id = await fresh();
    await admin().from('contracts').update({ status: 'completed' }).eq('id', id);
    captured.length = 0;
    const res = await api<{ error: { code: string } }>(user, `/api/contracts/${id}/process`, { method: 'POST' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('ALREADY_PROCESSED');
    expect(captured).toHaveLength(0);
  });
});

describe('the background function', () => {
  it('runs extraction → persist → key dates → summary for a signed job and writes the same telemetry rows', async () => {
    resetOpenAiStub();
    scriptOpenAi({ content: NDA_EXTRACTION }, { content: GOOD_SUMMARY });
    const id = await fresh();
    captured.length = 0;
    const enq = await api(user, `/api/contracts/${id}/process`, { method: 'POST' });
    expect(enq.status).toBe(202);
    const job = captured[0]!;

    const res = await invoke(job.body, job.signature);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string; term_count: number; summary_status: string };
    expect(body.status).toBe('completed');
    expect(body.term_count).toBe(10);
    expect(body.summary_status).toBe('completed');

    const { data: row } = await user.client
      .from('contracts')
      .select('status, processing_started_at, summary_status, summary_md, first_term_ready_ms')
      .eq('id', id)
      .single();
    expect(row?.status).toBe('completed');
    expect(row?.summary_status).toBe('completed');
    expect(row?.summary_md).toContain('[Page 1]');

    const { count: terms } = await user.client.from('key_terms').select('id', { count: 'exact', head: true }).eq('contract_id', id);
    expect(terms).toBe(10);

    const { data: calls } = await user.client.from('openai_calls').select('purpose, outcome').eq('contract_id', id);
    expect((calls ?? []).map((c) => `${c.purpose}:${c.outcome}`).sort()).toEqual(['extraction:success', 'summary:success']);

    const { data: runs } = await user.client.from('processing_runs').select('stage, outcome').eq('contract_id', id);
    const stages = (runs ?? []).map((r) => r.stage).sort();
    expect(stages).toEqual(['ai_extract', 'persist', 'summary', 'text_extract', 'total', 'upload']);
    expect((runs ?? []).every((r) => r.outcome === 'success')).toBe(true);

    // The results page's GET sees the finished contract exactly as after an inline run.
    const get = await api<{ contract: { status: string }; key_terms: unknown[] }>(user, `/api/contracts/${id}`);
    expect(get.status).toBe(200);
    expect(get.body.contract.status).toBe('completed');
    expect(get.body.key_terms).toHaveLength(10);
  }, 60_000);

  it('completes a job on a runtime with no native WebSocket (Netlify nodejs20.x, L3)', async () => {
    // supabase-js needs a WebSocket global to construct a client. Node 22+ has
    // one; Netlify's nodejs20.x does not, and the live function crashed there.
    const g = globalThis as unknown as { WebSocket?: unknown };
    const native = g.WebSocket;
    delete g.WebSocket;
    try {
      resetOpenAiStub();
      scriptOpenAi({ content: NDA_EXTRACTION }, { content: GOOD_SUMMARY });
      const id = await fresh();
      captured.length = 0;
      expect((await api(user, `/api/contracts/${id}/process`, { method: 'POST' })).status).toBe(202);
      const job = captured[0]!;

      const res = await invoke(job.body, job.signature);
      expect(res.status).toBe(200);
      expect(((await res.json()) as { status: string }).status).toBe('completed');
      expect(typeof g.WebSocket).toBe('function'); // the polyfill was installed

      const { data: row } = await user.client.from('contracts').select('status').eq('id', id).single();
      expect(row?.status).toBe('completed');
    } finally {
      g.WebSocket = native;
    }
  }, 60_000);

  it('rejects a bad signature with 401 and touches nothing', async () => {
    const id = await fresh();
    captured.length = 0;
    await api(user, `/api/contracts/${id}/process`, { method: 'POST' });
    const job = captured[0]!;

    const tampered = await invoke(job.body, signProcessJob(job.body, 'not-the-secret'));
    expect(tampered.status).toBe(401);
    expect(await tampered.json()).toEqual({ error: 'bad_signature' });

    const unsigned = await invoke(job.body, null);
    expect(unsigned.status).toBe(401);

    const { data: row } = await user.client.from('contracts').select('status').eq('id', id).single();
    expect(row?.status).toBe('processing');
    const { count } = await user.client.from('openai_calls').select('id', { count: 'exact', head: true }).eq('contract_id', id);
    expect(count).toBe(0);
  });

  it('a model failure is persisted as a retryable error, with no partial terms', async () => {
    resetOpenAiStub();
    scriptOpenAi({ content: 'x', status: 500 });
    const id = await fresh();
    captured.length = 0;
    await api(user, `/api/contracts/${id}/process`, { method: 'POST' });
    const job = captured[0]!;

    const res = await invoke(job.body, job.signature);
    expect(res.status).toBe(500);
    const { data: row } = await user.client.from('contracts').select('status, error_code, processing_started_at').eq('id', id).single();
    expect(row?.status).toBe('error');
    expect(row?.error_code).toBe('AI_UNAVAILABLE');
    expect(row?.processing_started_at).toBeNull();
    const { count } = await user.client.from('key_terms').select('id', { count: 'exact', head: true }).eq('contract_id', id);
    expect(count).toBe(0);
  }, 60_000);

  it('a job whose claim was lost (row no longer processing) is refused with 409', async () => {
    const id = await fresh();
    captured.length = 0;
    await api(user, `/api/contracts/${id}/process`, { method: 'POST' });
    const job = captured[0]!;
    await admin().from('contracts').update({ status: 'error', processing_started_at: null }).eq('id', id);
    const res = await invoke(job.body, job.signature);
    expect(res.status).toBe(409);
  });
});
