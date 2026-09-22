import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Stage 5d-1b / L6 (spec 06 v1.1 §3): a 429 is retried on the provider's own
 * clock, not our 1/2/4 s guess, and every failed attempt says why in the log.
 *
 * D51 (2026-09-22): the organization runs gpt-4o at Tier 2 — 450,000 TPM /
 * 5,000 RPM — so a single 36-term MSA run (~34k prompt tokens) no longer
 * approaches the ceiling. The eval runner can still send ~380k tokens in a
 * minute, so 429s remain reachable and must be handled, not guessed at.
 */

const h = vi.hoisted(() => ({
  create: vi.fn<(body: unknown, opts: { signal?: AbortSignal; timeout?: number }) => Promise<unknown>>(),
  // The REAL error classes, captured when the mocked module is evaluated: this
  // file mocks 'openai', so a static import of it would race the factory.
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

import { callLlm, parseRateLimitDuration } from '@/lib/ai/openai-client';

const OK = { choices: [{ message: { content: 'ok' } }], usage: { prompt_tokens: 10, completion_tokens: 5 } };

const BASE = {
  purpose: 'extraction' as const,
  messages: [{ role: 'user' as const, content: 'hi' }],
  temperature: 0.1,
  maxTokens: 100,
  userId: 'u1',
  supabase: {} as never,
};

/** A 429 exactly as the SDK builds one: body carries `code`, headers carry the clock. */
function rateLimited(headers: Record<string, string>, code?: string) {
  const Errors = h.errors!;
  return new Errors.APIError(429, code ? { code } : undefined, 'rate limit reached', new Headers(headers));
}

describe('parseRateLimitDuration (L6)', () => {
  it.each([
    ['6m0s', 360_000],
    ['1.2s', 1_200],
    ['20ms', 20],
    ['250ms', 250],
    ['1h2m3s', 3_723_000],
    ['0s', 0],
  ])('parses %s', (raw, expected) => {
    expect(parseRateLimitDuration(raw)).toBe(expected);
  });

  it.each([['banana'], ['6x'], [''], ['  '], ['12'], ['s'], ['1.2.3s']])('rejects %j as null', (raw) => {
    expect(parseRateLimitDuration(raw)).toBeNull();
  });

  it('returns null for a missing header', () => {
    expect(parseRateLimitDuration(null)).toBeNull();
    expect(parseRateLimitDuration(undefined)).toBeNull();
  });
});

describe('429 backoff from provider headers (L6)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    h.create.mockReset();
    // ±10% jitter: 0.9 + 0.5 × 0.2 = 1.0, so the wait is exactly the header.
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    // The L6 diagnostic line is asserted in its own suite below; here it is
    // only noise. console.error covers the insufficient_quota callout.
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('waits the retry-after-ms header before attempt 2', async () => {
    h.create.mockRejectedValueOnce(rateLimited({ 'retry-after-ms': '4000' })).mockResolvedValueOnce(OK);

    const pending = callLlm({ ...BASE, maxAttempts: 2 });

    await vi.advanceTimersByTimeAsync(3_999);
    expect(h.create).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    expect(h.create).toHaveBeenCalledTimes(2);
    await expect(pending).resolves.toMatchObject({ attempts: 2 });
  });

  it('falls back to retry-after in seconds', async () => {
    h.create.mockRejectedValueOnce(rateLimited({ 'retry-after': '3' })).mockResolvedValueOnce(OK);

    const pending = callLlm({ ...BASE, maxAttempts: 2 });

    await vi.advanceTimersByTimeAsync(2_999);
    expect(h.create).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    expect(h.create).toHaveBeenCalledTimes(2);
    await expect(pending).resolves.toMatchObject({ attempts: 2 });
  });

  it('honours x-ratelimit-reset-tokens "1.5s"', async () => {
    h.create.mockRejectedValueOnce(rateLimited({ 'x-ratelimit-reset-tokens': '1.5s' })).mockResolvedValueOnce(OK);

    const pending = callLlm({ ...BASE, maxAttempts: 2 });

    await vi.advanceTimersByTimeAsync(1_499);
    expect(h.create).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    expect(h.create).toHaveBeenCalledTimes(2);
    await expect(pending).resolves.toMatchObject({ attempts: 2 });
  });

  it('takes the LARGER of the two reset headers', async () => {
    h.create
      .mockRejectedValueOnce(rateLimited({ 'x-ratelimit-reset-requests': '200ms', 'x-ratelimit-reset-tokens': '2s' }))
      .mockResolvedValueOnce(OK);

    const pending = callLlm({ ...BASE, maxAttempts: 2 });

    await vi.advanceTimersByTimeAsync(1_999);
    expect(h.create).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    expect(h.create).toHaveBeenCalledTimes(2);
    await expect(pending).resolves.toMatchObject({ attempts: 2 });
  });

  it('caps a long provider wait at 30 s', async () => {
    h.create.mockRejectedValueOnce(rateLimited({ 'x-ratelimit-reset-tokens': '6m0s' })).mockResolvedValueOnce(OK);

    const pending = callLlm({ ...BASE, maxAttempts: 2 });

    await vi.advanceTimersByTimeAsync(29_999);
    expect(h.create).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    expect(h.create).toHaveBeenCalledTimes(2);
    await expect(pending).resolves.toMatchObject({ attempts: 2 });
  });

  it('falls back to the 1/2/4 s schedule when the 429 carries no header', async () => {
    h.create.mockRejectedValueOnce(rateLimited({})).mockResolvedValueOnce(OK);

    const pending = callLlm({ ...BASE, maxAttempts: 2 });

    await vi.advanceTimersByTimeAsync(999);
    expect(h.create).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    expect(h.create).toHaveBeenCalledTimes(2);
    await expect(pending).resolves.toMatchObject({ attempts: 2 });
  });

  it('stops without a second attempt when the wait would overrun the deadline', async () => {
    // 20 s wait + the 6 s minimum attempt budget does not fit in 20 s.
    h.create.mockRejectedValueOnce(rateLimited({ 'retry-after-ms': '20000' })).mockResolvedValueOnce(OK);

    await expect(callLlm({ ...BASE, maxAttempts: 3, deadlineAt: Date.now() + 20_000 })).rejects.toThrow();

    expect(h.create).toHaveBeenCalledTimes(1);
  });

  it('does not retry a 429 whose code is insufficient_quota — that is billing, not rate', async () => {
    h.create.mockRejectedValueOnce(rateLimited({ 'retry-after-ms': '1000' }, 'insufficient_quota')).mockResolvedValueOnce(OK);

    await expect(callLlm({ ...BASE, maxAttempts: 3 })).rejects.toThrow();

    expect(h.create).toHaveBeenCalledTimes(1);
  });
});

describe('attempt_failed diagnostics (L6)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    h.create.mockReset();
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  function warnedAttempts(warn: ReturnType<typeof vi.spyOn>): Array<Record<string, unknown>> {
    return warn.mock.calls
      .map((c) => c[0])
      .filter((line): line is string => typeof line === 'string')
      .map((line) => JSON.parse(line) as Record<string, unknown>)
      .filter((o) => o.llm === 'attempt_failed');
  }

  it('logs one line per failed attempt carrying the error class, status and code', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    h.create.mockRejectedValueOnce(rateLimited({ 'retry-after-ms': '1000' }, 'rate_limit_exceeded')).mockResolvedValueOnce(OK);

    const pending = callLlm({ ...BASE, maxAttempts: 2 });
    await vi.advanceTimersByTimeAsync(1_000);
    await pending;

    const lines = warnedAttempts(warn);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      llm: 'attempt_failed',
      purpose: 'extraction',
      attempt: 1,
      name: 'APIError',
      status: 429,
      code: 'rate_limit_exceeded',
      retryAfterMs: 1_000,
    });
    expect(lines[0]).toHaveProperty('latencyMs');
  });

  it('never puts prompt text or key material in the log line', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    h.create.mockRejectedValueOnce(rateLimited({}, 'insufficient_quota'));

    await expect(callLlm({ ...BASE, messages: [{ role: 'user', content: 'SECRET CONTRACT TEXT' }], maxAttempts: 1 })).rejects.toThrow();

    const serialised = JSON.stringify(warnedAttempts(warn));
    expect(serialised).not.toContain('SECRET CONTRACT TEXT');
    expect(serialised).not.toContain('test-key');
  });
});
