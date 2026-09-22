import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Stage 5d-0 / L4 (spec 06 v1.1 §B): the summary call's timeout is capped by
 * the caller's deadline, and a claim with < 3 s left issues no call and leaves
 * the row `pending` for route 34.
 */

import type { LlmCallOptions, LlmResult } from '@/lib/ai/openai-client';

const callLlm = vi.fn<(opts: LlmCallOptions) => Promise<LlmResult>>();
vi.mock('@/lib/ai/openai-client', () => ({ callLlm: (opts: LlmCallOptions) => callLlm(opts) }));
vi.mock('@/lib/utils/server-config', () => ({
  getServerConfig: () => ({
    OPENAI_SUMMARY_TEMPERATURE: 0.2,
    OPENAI_SUMMARY_MAX_TOKENS: 500,
    OPENAI_SUMMARY_TIMEOUT_MS: 20_000,
  }),
}));
vi.mock('@/lib/metrics/timings', () => ({ recordProcessingRun: vi.fn(async () => undefined) }));
vi.mock('@/lib/metrics/events', () => ({ recordEvent: vi.fn(async () => undefined) }));

import { runSummary } from '@/lib/services/summary-service';

type Update = Record<string, unknown>;

function fakeSupabase() {
  const updates: Update[] = [];
  const builder = {
    update(values: Update) {
      updates.push(values);
      return builder;
    },
    eq() {
      return builder;
    },
    then(resolve: (v: unknown) => void) {
      resolve({ data: null, error: null });
    },
  };
  return { updates, client: { from: () => builder } as never };
}

const contract = { id: 'c1', user_id: 'u1', contract_text: '[PAGE 1]\nAn agreement.', page_count: 1 };
const CITED = 'This agreement is between two parties. [Page 1]';

describe('summary call budget (L4)', () => {
  const T0 = 1_700_000_000_000;
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
    callLlm.mockReset();
  });
  afterEach(() => vi.useRealTimers());

  it('uses the configured 20 s timeout when no deadline is given', async () => {
    callLlm.mockResolvedValueOnce({ content: CITED, promptTokens: 1, completionTokens: 1, latencyMs: 1, attempts: 1 });
    const { client } = fakeSupabase();
    await runSummary(client, contract, [], {});
    expect(callLlm).toHaveBeenCalledTimes(1);
    expect(callLlm.mock.calls[0]![0].timeoutMs).toBe(20_000);
  });

  it('caps the timeout at deadlineAt − now − 1 s', async () => {
    callLlm.mockResolvedValueOnce({ content: CITED, promptTokens: 1, completionTokens: 1, latencyMs: 1, attempts: 1 });
    const { client } = fakeSupabase();
    await runSummary(client, contract, [], { deadlineAt: T0 + 8_000 });
    expect(callLlm).toHaveBeenCalledTimes(1);
    expect(callLlm.mock.calls[0]![0].timeoutMs).toBe(7_000);
    expect(callLlm.mock.calls[0]![0].deadlineAt).toBe(T0 + 8_000);
  });

  it('issues no call and leaves the row pending when < 3 s remain', async () => {
    const { client, updates } = fakeSupabase();
    const result = await runSummary(client, contract, [], { deadlineAt: T0 + 2_500 });
    expect(callLlm).not.toHaveBeenCalled();
    expect(result.summary_status).toBe('pending');
    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatchObject({ summary_status: 'pending' });
    expect(updates[0]).not.toHaveProperty('summary_error_code', expect.anything());
  });

  it('caps the repair call too, and skips it when the first call used the budget (route 34: 22 s)', async () => {
    // First call: consumes 20 s of a 22 s budget and comes back uncited.
    callLlm.mockImplementationOnce(async () => {
      vi.setSystemTime(T0 + 20_000);
      return { content: 'The fee is 500 dollars.', promptTokens: 1, completionTokens: 1, latencyMs: 20_000, attempts: 1 };
    });
    const { client, updates } = fakeSupabase();
    const result = await runSummary(client, contract, [], { deadlineAt: T0 + 22_000 });
    expect(callLlm).toHaveBeenCalledTimes(1);
    expect(callLlm.mock.calls[0]![0].timeoutMs).toBe(20_000);
    expect(result.summary_status).toBe('completed');
    expect(result.summary_uncited).toBe(true);
    expect(updates[0]).toMatchObject({ summary_status: 'completed', summary_uncited: true });
  });

  it('gives the repair call min(20 s, remaining − 1 s) when it does run', async () => {
    callLlm.mockImplementationOnce(async () => {
      vi.setSystemTime(T0 + 10_000);
      return { content: 'The fee is 500 dollars.', promptTokens: 1, completionTokens: 1, latencyMs: 10_000, attempts: 1 };
    });
    callLlm.mockResolvedValueOnce({ content: 'The fee is 500 dollars. [Page 1]', promptTokens: 1, completionTokens: 1, latencyMs: 1, attempts: 1 });
    const { client } = fakeSupabase();
    const result = await runSummary(client, contract, [], { deadlineAt: T0 + 22_000 });
    expect(callLlm).toHaveBeenCalledTimes(2);
    expect(callLlm.mock.calls[1]![0].timeoutMs).toBe(11_000);
    expect(result.summary_uncited).toBe(false);
  });
});
