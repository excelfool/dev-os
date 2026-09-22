import { describe, expect, it } from 'vitest';
import { SUMMARY_MIN_REMAINING_MS, shouldClaimSummaryInline } from '@/lib/services/summary-service';

/**
 * Spec 06 v1.1 §B — step 11a claims inline only with enough budget for one
 * 10 s call plus validation; otherwise the results page completes it via
 * route 34. Stage 5a: threshold raised from 11 s to 15 s.
 */
describe('summary inline-claim threshold', () => {
  it('is 15 s', () => {
    expect(SUMMARY_MIN_REMAINING_MS).toBe(15_000);
  });

  it('claims at exactly 15 s remaining and above', () => {
    expect(shouldClaimSummaryInline(15_000)).toBe(true);
    expect(shouldClaimSummaryInline(20_000)).toBe(true);
  });

  it('defers below 15 s — including the old 11–14 s window', () => {
    expect(shouldClaimSummaryInline(14_999)).toBe(false);
    expect(shouldClaimSummaryInline(12_000)).toBe(false);
    expect(shouldClaimSummaryInline(11_000)).toBe(false);
    expect(shouldClaimSummaryInline(0)).toBe(false);
    expect(shouldClaimSummaryInline(-500)).toBe(false);
  });
});
