import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LlmCallOptions, LlmResult } from '@/lib/ai/openai-client';

/**
 * Stage 5d-1 / L5 (spec 06 v1.1 §3/§G): extraction and its JSON-repair call
 * run on OPENAI_EXTRACTION_TIMEOUT_MS (45 s), not the 20 s general timeout
 * that was sized for the 24 s inline deadline. Real 36-term MSA batches take
 * 14–16 s, so a 20 s cap killed the background job on one slow call.
 */

const callLlm = vi.fn<(opts: LlmCallOptions) => Promise<LlmResult>>();
vi.mock('@/lib/ai/openai-client', () => ({ callLlm: (opts: LlmCallOptions) => callLlm(opts) }));

vi.mock('@/lib/utils/server-config', () => ({
  getServerConfig: () => ({
    OPENAI_EXTRACTION_TEMPERATURE: 0.1,
    OPENAI_EXTRACTION_MAX_TOKENS: 4000,
    OPENAI_EXTRACTION_TIMEOUT_MS: 45_000,
    OPENAI_TIMEOUT_MS: 20_000,
  }),
}));

vi.mock('@/lib/services/summary-service', () => ({
  shouldClaimSummaryInline: () => false,
  claimSummaryInline: vi.fn(async () => false),
  runSummary: vi.fn(),
}));
vi.mock('@/lib/services/reminder-service', () => ({ deriveKeyDatesBounded: vi.fn(async () => undefined) }));
vi.mock('@/lib/metrics/timings', () => ({ recordProcessingRun: vi.fn(async () => undefined) }));
vi.mock('@/lib/metrics/events', () => ({ recordEvent: vi.fn(async () => undefined) }));

import { runProcessingPipeline } from '@/lib/services/process-pipeline';

function fakeSupabase() {
  const q: Record<string, unknown> = {};
  Object.assign(q, {
    select: () => q,
    eq: () => q,
    update: () => q,
    order: async () => ({ data: [], error: null }),
    then: (resolve: (v: unknown) => void) => resolve({ data: [], error: null }),
  });
  return { from: () => q, rpc: async () => ({ data: [], error: null }) } as never;
}

const CONTRACT = {
  id: 'c1',
  user_id: 'u1',
  contract_type: 'NDA',
  contract_text: '[PAGE 1]\nThis Agreement is governed by the laws of the State of Delaware.',
  page_count: 1,
  ocr_confidence: null,
};

function llmResult(content: string): LlmResult {
  return { content, promptTokens: 10, completionTokens: 5, latencyMs: 1, attempts: 1 };
}

const EMPTY_EXTRACTION = JSON.stringify({ detected_type: 'NDA', terms: [] });

async function run() {
  const now = Date.now();
  return runProcessingPipeline({
    supabase: fakeSupabase(),
    contract: CONTRACT,
    userId: 'u1',
    deadlineAt: now + 120_000,
    startedAt: now,
  });
}

describe('extraction call timeout (L5)', () => {
  beforeEach(() => callLlm.mockReset());

  it('gives the extraction call OPENAI_EXTRACTION_TIMEOUT_MS (45 s)', async () => {
    callLlm.mockResolvedValueOnce(llmResult(EMPTY_EXTRACTION));

    await run();

    expect(callLlm).toHaveBeenCalledTimes(1);
    expect(callLlm.mock.calls[0]![0].purpose).toBe('extraction');
    expect(callLlm.mock.calls[0]![0].timeoutMs).toBe(45_000);
  });

  it('gives the JSON-repair call the same 45 s', async () => {
    callLlm.mockResolvedValueOnce(llmResult('not json at all')).mockResolvedValueOnce(llmResult(EMPTY_EXTRACTION));

    await run();

    expect(callLlm).toHaveBeenCalledTimes(2);
    expect(callLlm.mock.calls[1]![0].purpose).toBe('repair');
    expect(callLlm.mock.calls[1]![0].timeoutMs).toBe(45_000);
  });

  it('passes the job deadline through, so callLlm still caps the attempt', async () => {
    callLlm.mockResolvedValueOnce(llmResult(EMPTY_EXTRACTION));

    await run();

    expect(callLlm.mock.calls[0]![0].deadlineAt).toBeGreaterThan(Date.now());
  });
});
