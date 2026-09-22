import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Stage 5d-0 / L4: route 34 hands runSummary a deadline of request start
 * + 22 s (Netlify sync ceiling 26 s, D36).
 */

const runSummary = vi.fn();
vi.mock('@/lib/services/summary-service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/services/summary-service')>();
  return {
    SUMMARY_ROUTE_DEADLINE_MS: actual.SUMMARY_ROUTE_DEADLINE_MS,
    runSummary: (...args: unknown[]) => runSummary(...args),
    claimSummaryDeferred: async () => true,
  };
});
vi.mock('@/lib/security/rate-limit', () => ({ enforceRateLimit: vi.fn(async () => undefined) }));
vi.mock('@/lib/supabase/server', () => {
  const contract = { id: 'c1', user_id: 'u1', status: 'completed', contract_text: 'x', page_count: 1 };
  const contracts = {
    select: () => contracts,
    eq: () => contracts,
    order: () => contracts,
    single: async () => ({ data: contract, error: null }),
  };
  const terms = {
    select: () => terms,
    eq: () => terms,
    order: async () => ({ data: [], error: null }),
  };
  return {
    createServerSupabaseClient: () => ({
      auth: { getUser: async () => ({ data: { user: { id: 'u1' } } }) },
      from: (table: string) => (table === 'contracts' ? contracts : terms),
    }),
  };
});

import { POST } from '@/app/api/contracts/[id]/summary/route';
import { SUMMARY_ROUTE_DEADLINE_MS } from '@/lib/services/summary-service';

describe('route 34 deadline', () => {
  const T0 = 1_700_000_000_000;
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
    runSummary.mockReset();
  });
  afterEach(() => vi.useRealTimers());

  it('is 22 s', () => {
    expect(SUMMARY_ROUTE_DEADLINE_MS).toBe(22_000);
  });

  it('passes deadlineAt = request start + 22 s to runSummary', async () => {
    runSummary.mockResolvedValueOnce({ summary_md: 'ok', summary_status: 'completed', summary_uncited: false, summary_generated_ms: 1 });
    const res = await POST(new Request('http://localhost/api/contracts/c1/summary', { method: 'POST' }), { params: { id: 'c1' } });
    expect(res.status).toBe(200);
    expect(runSummary).toHaveBeenCalledTimes(1);
    expect(runSummary.mock.calls[0]![3]).toEqual({ deadlineAt: T0 + 22_000 });
  });
});
