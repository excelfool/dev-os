import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Spec 08 v1.1 §D/§E and spec 21 §4 — RetrievalStrategy and the external RAG
 * adapter.
 */

const cfg: Record<string, unknown> = {};
vi.mock('@/lib/utils/server-config', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/utils/server-config')>()),
  getServerConfig: () => cfg,
}));

import { parseServerEnv } from '@/lib/utils/server-config';
import { getRetrievalStrategy } from '@/lib/ai/retrieval';
import { FullContextStrategy } from '@/lib/ai/retrieval/full-context';
import { N8nStrategy } from '@/lib/ai/retrieval/n8n';
import { VectorRagStrategy } from '@/lib/ai/retrieval/vector-rag';
import { GraphRagStrategy } from '@/lib/ai/retrieval/graph-rag';
import { getRagAdapter, NullRagAdapter } from '@/lib/integrations/rag';
import { N8nRagAdapter } from '@/lib/integrations/rag/n8n-adapter';
import { assembleChatMessages, assembleFromBlocks, validateDelegatedAnswer } from '@/lib/services/chat-service';
import { AppError } from '@/lib/errors/app-error';
import type { QueryClass } from '@/types/domain';

const REQUIRED = { SUPABASE_SERVICE_ROLE_KEY: 'x', OPENAI_API_KEY: 'x' };
const CONTRACT = { id: 'c1', contract_text: '[PAGE 1]\nThe term renews.\n\n[PAGE 2]\nNotice is 60 days.', page_count: 2 };
const HISTORY = [
  { role: 'user' as const, content: 'Is there an auto-renewal clause?' },
  { role: 'assistant' as const, content: 'Based on the document, yes. [Page 1]' },
];

beforeEach(() => {
  for (const key of Object.keys(cfg)) delete cfg[key];
});

describe('RETRIEVAL_STRATEGY in server config', () => {
  it('defaults to full_context', () => {
    const parsed = parseServerEnv(REQUIRED);
    expect(parsed.success && parsed.data.RETRIEVAL_STRATEGY).toBe('full_context');
  });

  it('accepts n8n (a stub an operator can configure)', () => {
    expect(parseServerEnv({ ...REQUIRED, RETRIEVAL_STRATEGY: 'n8n' }).success).toBe(true);
  });

  it.each([
    ['vector', 'retrieval.vector', 'stub'],
    ['graph', 'retrieval.graph', 'planned'],
  ])('rejects %s at boot while %s is not built', (value, capability, status) => {
    const parsed = parseServerEnv({ ...REQUIRED, RETRIEVAL_STRATEGY: value });
    expect(parsed.success).toBe(false);
    expect(parsed.error!.issues[0]!.message).toBe(`RETRIEVAL_STRATEGY=${value} needs ${capability} to be built (it is ${status})`);
  });

  it('getRetrievalStrategy returns full-context by default', () => {
    cfg.RETRIEVAL_STRATEGY = 'full_context';
    expect(getRetrievalStrategy()).toBeInstanceOf(FullContextStrategy);
  });
});

describe('full_context produces the same prompt as before', () => {
  it.each<[QueryClass, string | null]>([
    ['contract', null],
    ['contract', 'auto-renewal notice period'],
    ['both', 'supplier notice period'],
    ['history', null],
  ])('%s with enhancedQuery=%j', async (queryClass, enhancedQuery) => {
    const strategy = new FullContextStrategy();
    const result = await strategy.buildContext({
      contract: CONTRACT,
      question: 'how much notice?',
      enhancedQuery,
      queryClass,
      history: HISTORY,
      deadlineAt: Date.now() + 15_000,
    });
    expect(result.mode).toBe('context');
    const viaStrategy = assembleFromBlocks({
      queryClass,
      contextBlocks: result.mode === 'context' ? result.blocks : [],
      history: HISTORY,
      userMessage: 'how much notice?',
      maxHistoryTokens: 8_000,
    });
    const before = assembleChatMessages({
      queryClass,
      contractText: CONTRACT.contract_text,
      history: HISTORY,
      userMessage: 'how much notice?',
      maxHistoryTokens: 8_000,
      enhancedQuery,
    });
    expect(viaStrategy).toEqual(before);
  });
});

describe('the n8n adapter', () => {
  it('POSTs the spec 08 §D payload with the token header and returns the answer', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ answer: 'Based on the document, 60 days. [Page 2]', cited_pages: [2] }), { status: 200 }),
    );
    const adapter = new N8nRagAdapter('https://n8n.example/webhook/rag', 'tok-123', fetchImpl as unknown as typeof fetch);

    const result = await adapter.answer({
      contractId: 'c1',
      question: 'how much notice?',
      enhancedQuery: 'non-renewal notice period',
      history: HISTORY,
      deadlineAt: Date.now() + 15_000,
    });

    expect(result).toEqual({ ok: true, value: { answer: 'Based on the document, 60 days. [Page 2]', cited_pages: [2] } });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://n8n.example/webhook/rag');
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({ Authorization: 'Bearer tok-123', 'Content-Type': 'application/json' });
    expect(JSON.parse(init.body as string)).toEqual({
      contract_id: 'c1',
      question: 'how much notice?',
      enhanced_query: 'non-renewal notice period',
      history: HISTORY,
    });
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('a malformed response is a VENDOR_ERROR, not an answer', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ text: 'nope' }), { status: 200 }));
    const adapter = new N8nRagAdapter('https://n8n.example/rag', 't', fetchImpl as unknown as typeof fetch);
    const result = await adapter.answer({ contractId: 'c1', question: 'q', enhancedQuery: null, history: [], deadlineAt: Date.now() + 15_000 });
    expect(result).toMatchObject({ ok: false, reason: 'VENDOR_ERROR', capability: 'retrieval.n8n' });
  });

  it('shares the turn budget: an exhausted deadline makes no call', async () => {
    const fetchImpl = vi.fn();
    const adapter = new N8nRagAdapter('https://n8n.example/rag', 't', fetchImpl as unknown as typeof fetch);
    const result = await adapter.answer({ contractId: 'c1', question: 'q', enhancedQuery: null, history: [], deadlineAt: Date.now() });
    expect(result).toMatchObject({ ok: false, reason: 'VENDOR_ERROR', message: 'TIMEOUT' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('the strategy returns the delegated answer as-is; validation is the route’s job', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ answer: 'See [Page 9].', cited_pages: [9] }), { status: 200 }));
    const strategy = new N8nStrategy(new N8nRagAdapter('https://n8n.example/rag', 't', fetchImpl as unknown as typeof fetch));
    const result = await strategy.buildContext({
      contract: CONTRACT,
      question: 'q',
      enhancedQuery: null,
      queryClass: 'contract',
      history: [],
      deadlineAt: Date.now() + 15_000,
    });
    expect(result).toEqual({ mode: 'delegated', answer: 'See [Page 9].', cited_pages: [9] });
  });
});

describe('a delegated answer passes the shared citation validation', () => {
  it('drops an out-of-range page and keeps the valid one', () => {
    expect(validateDelegatedAnswer('Notice is 60 days. [Page 2]', [2, 9], 2, 'contract')).toEqual({ citedPages: [2], citationVerified: true });
  });

  it('an answer citing only out-of-range pages is unverified', () => {
    expect(validateDelegatedAnswer('See [Page 9].', [9], 2, 'contract')).toEqual({ citedPages: [], citationVerified: false });
  });

  it('pages cited in the text count even when the backend claims none; multi-page forms parse', () => {
    expect(validateDelegatedAnswer('Both apply. [Pages 1–2]', [], 2, 'contract')).toEqual({ citedPages: [1, 2], citationVerified: true });
  });

  it('the exact fallback and history answers need no page', () => {
    expect(validateDelegatedAnswer('I cannot find this in the document.', [], 2, 'contract')).toEqual({ citedPages: [], citationVerified: true });
    expect(validateDelegatedAnswer('You asked about notice.', [7], 2, 'history')).toEqual({ citedPages: [], citationVerified: true });
  });
});

describe('getRagAdapter and the NullAdapter under retrieval.n8n', () => {
  it.each([
    [{}, NullRagAdapter],
    [{ N8N_RAG_WEBHOOK_URL: 'https://n8n.example/rag' }, NullRagAdapter],
    [{ N8N_RAG_TOKEN: 't' }, NullRagAdapter],
    [{ N8N_RAG_WEBHOOK_URL: 'https://n8n.example/rag', N8N_RAG_TOKEN: 't' }, N8nRagAdapter],
  ])('config %j ⇒ %o', (env, expected) => {
    Object.assign(cfg, env);
    expect(getRagAdapter()).toBeInstanceOf(expected);
  });

  it('the NullAdapter under retrieval.n8n yields 501 NOT_IMPLEMENTED with capability retrieval.n8n', async () => {
    cfg.RETRIEVAL_STRATEGY = 'n8n';
    const strategy = getRetrievalStrategy();
    expect(strategy).toBeInstanceOf(N8nStrategy);

    let thrown: unknown;
    try {
      strategy.assertAvailable();
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(AppError);
    expect(thrown).toMatchObject({ code: 'NOT_IMPLEMENTED', httpStatus: 501, details: { capability: 'retrieval.n8n' } });

    await expect(
      strategy.buildContext({ contract: CONTRACT, question: 'q', enhancedQuery: null, queryClass: 'contract', history: [], deadlineAt: Date.now() + 15_000 }),
    ).rejects.toMatchObject({ code: 'NOT_IMPLEMENTED', httpStatus: 501 });
  });
});

describe('vector and graph are stubs that never answer', () => {
  it.each([
    [new VectorRagStrategy(), 'retrieval.vector'],
    [new GraphRagStrategy(), 'retrieval.graph'],
  ])('%o throws NOT_IMPLEMENTED with its key', async (strategy, key) => {
    expect(() => strategy.assertAvailable()).toThrow(AppError);
    await expect(strategy.buildContext()).rejects.toMatchObject({ code: 'NOT_IMPLEMENTED', details: { capability: key } });
  });
});
