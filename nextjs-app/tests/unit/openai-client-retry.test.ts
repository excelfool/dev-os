import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Stage 5d-1 / L5 (spec 06 v1.1 §3/§G). Two properties of `callLlm`:
 *
 * 1. Timeouts and connection failures are retryable. The SDK models all three
 *    of them as `APIError` subclasses whose `status` is `undefined`, so a
 *    classifier that reaches the status check first can never retry them.
 * 2. `callLlm`'s loop is the ONLY retry layer — the SDK client is built with
 *    `maxRetries: 0` — so every attempt writes its own `openai_calls` row and
 *    the deadline arithmetic is not multiplied behind our back.
 */

const h = vi.hoisted(() => ({
  create: vi.fn<(body: unknown, opts: { signal?: AbortSignal; timeout?: number }) => Promise<unknown>>(),
  constructorArgs: [] as Array<Record<string, unknown>>,
  // The REAL error classes, captured when the mocked module is evaluated. The
  // test cannot `import` them directly: this file mocks 'openai', so a static
  // import of it would race the factory.
  errors: null as typeof import('openai') | null,
}));

vi.mock('openai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('openai')>();
  h.errors = actual;
  class MockOpenAI {
    static APIError = actual.APIError;
    static APIConnectionError = actual.APIConnectionError;
    static APIConnectionTimeoutError = actual.APIConnectionTimeoutError;
    static APIUserAbortError = actual.APIUserAbortError;
    chat = { completions: { create: h.create } };
    constructor(opts: Record<string, unknown>) {
      h.constructorArgs.push(opts);
    }
  }
  return { ...actual, default: MockOpenAI };
});

vi.mock('@/lib/utils/server-config', () => ({
  getServerConfig: () => ({
    OPENAI_API_KEY: 'test-key',
    OPENAI_BASE_URL: '',
    OPENAI_MODEL: 'gpt-4o',
    OPENAI_MODEL_EXTRACTION: '',
    OPENAI_MODEL_CHAT: '',
    OPENAI_MODEL_SUMMARY: '',
    OPENAI_MODEL_ENHANCER: '',
    OPENAI_MODEL_JUDGE: '',
    OPENAI_TIMEOUT_MS: 20_000,
    OPENAI_EXTRACTION_TIMEOUT_MS: 45_000,
    OPENAI_MAX_RETRIES: 3,
  }),
}));

vi.mock('@/lib/metrics/cost', () => ({ recordOpenAiCall: vi.fn(async () => undefined) }));

import { callLlm } from '@/lib/ai/openai-client';

/** Real SDK error classes; `callLlm`'s `instanceof` checks resolve to these. */
const E = () => h.errors!;

const OK = { choices: [{ message: { content: 'ok' } }], usage: { prompt_tokens: 10, completion_tokens: 5 } };

const BASE = {
  purpose: 'chat' as const,
  messages: [{ role: 'user' as const, content: 'hi' }],
  temperature: 0.4,
  maxTokens: 100,
  userId: 'u1',
  supabase: {} as never,
};

describe('callLlm retry classification (L5)', () => {
  beforeEach(() => {
    h.create.mockReset();
    // L6 logs one `attempt_failed` line per failed attempt; not this suite's
    // subject, and asserted in tests/unit/openai-rate-limit.test.ts.
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => vi.restoreAllMocks());

  it.each([
    ['APIUserAbortError (our own per-attempt abort)', () => new (E().APIUserAbortError)()],
    ['APIConnectionTimeoutError', () => new (E().APIConnectionTimeoutError)()],
    ['APIConnectionError', () => new (E().APIConnectionError)({ message: 'socket hang up' })],
  ])('retries after %s', async (_label, make) => {
    h.create.mockRejectedValueOnce(make()).mockResolvedValueOnce(OK);

    const result = await callLlm({ ...BASE, maxAttempts: 2 });

    expect(h.create).toHaveBeenCalledTimes(2);
    expect(result.attempts).toBe(2);
  });

  it('does not retry a 400 — retrying cannot fix a bad request', async () => {
    // A second attempt would succeed, so the call count is what proves it.
    h.create.mockRejectedValueOnce(new (E().APIError)(400, undefined, 'bad request', undefined)).mockResolvedValueOnce(OK);

    await expect(callLlm({ ...BASE, maxAttempts: 3 })).rejects.toThrow();

    expect(h.create).toHaveBeenCalledTimes(1);
  });

  it.each([429, 500])('retries a %i', async (status) => {
    h.create.mockRejectedValueOnce(new (E().APIError)(status, undefined, 'upstream', undefined)).mockResolvedValueOnce(OK);

    const result = await callLlm({ ...BASE, maxAttempts: 2 });

    expect(h.create).toHaveBeenCalledTimes(2);
    expect(result.attempts).toBe(2);
  });
});

describe('callLlm timeout plumbing (L5)', () => {
  beforeEach(() => {
    h.create.mockReset();
    // L6 logs one `attempt_failed` line per failed attempt; not this suite's
    // subject, and asserted in tests/unit/openai-rate-limit.test.ts.
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => vi.restoreAllMocks());

  it('uses OPENAI_TIMEOUT_MS (20 s) when the caller sets no override — chat and the query enhancer', async () => {
    h.create.mockResolvedValueOnce(OK);

    await callLlm({ ...BASE });

    expect(h.create.mock.calls[0]![1].timeout).toBe(20_000);
  });

  it('uses the caller override — extraction asks for 45 s', async () => {
    h.create.mockResolvedValueOnce(OK);

    await callLlm({ ...BASE, purpose: 'extraction', timeoutMs: 45_000 });

    expect(h.create.mock.calls[0]![1].timeout).toBe(45_000);
  });

  it('caps a 45 s extraction attempt at the remaining budget under the 24 s inline deadline', async () => {
    h.create.mockResolvedValueOnce(OK);

    await callLlm({ ...BASE, purpose: 'extraction', timeoutMs: 45_000, deadlineAt: Date.now() + 24_000 });

    const timeout = h.create.mock.calls[0]![1].timeout as number;
    expect(timeout).toBeLessThanOrEqual(23_000);
    expect(timeout).toBeGreaterThan(22_000);
  });

  it('builds the SDK client with maxRetries 0 — callLlm is the only retry layer', async () => {
    h.create.mockResolvedValueOnce(OK);

    await callLlm({ ...BASE });

    expect(h.constructorArgs).toHaveLength(1);
    expect(h.constructorArgs[0]).toMatchObject({ maxRetries: 0 });
  });
});
