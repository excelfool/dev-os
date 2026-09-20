import type { TermOutcome } from './extraction-f1';

/**
 * Calibration curve: predicted confidence vs observed accuracy in 10% buckets
 * (spec 17 §2). Calibration error ≤ 0.10; each bucket within ±10%.
 *
 * Error is the sample-weighted mean absolute gap between a bucket's mean
 * confidence and its observed accuracy — expected calibration error. Weighting
 * matters: an empty-ish bucket should not swing the headline number.
 */
export interface CalibrationBucket {
  bucket: string;
  lower: number;
  upper: number;
  count: number;
  meanConfidence: number | null;
  observedAccuracy: number | null;
  gap: number | null;
  withinTolerance: boolean | null;
}

export function calibration(outcomes: TermOutcome[]) {
  // Only terms the model actually asserted carry a meaningful confidence.
  const scored = outcomes.filter((o) => o.actual !== null);

  const buckets: CalibrationBucket[] = [];
  for (let lower = 0; lower < 100; lower += 10) {
    const upper = lower + 10;
    const rows = scored.filter((o) =>
      lower === 90 ? o.confidence >= lower && o.confidence <= 100 : o.confidence >= lower && o.confidence < upper,
    );

    const meanConfidence =
      rows.length === 0 ? null : rows.reduce((sum, r) => sum + r.confidence, 0) / rows.length / 100;
    const observedAccuracy =
      rows.length === 0 ? null : rows.filter((r) => r.outcome === 'tp').length / rows.length;
    const gap =
      meanConfidence === null || observedAccuracy === null
        ? null
        : Math.abs(meanConfidence - observedAccuracy);

    buckets.push({
      bucket: `${lower}-${upper}`,
      lower,
      upper,
      count: rows.length,
      meanConfidence,
      observedAccuracy,
      gap,
      withinTolerance: gap === null ? null : gap <= 0.10,
    });
  }

  const populated = buckets.filter((b) => b.count > 0 && b.gap !== null);
  const totalCount = populated.reduce((sum, b) => sum + b.count, 0);
  const error =
    totalCount === 0 ? null : populated.reduce((sum, b) => sum + b.gap! * b.count, 0) / totalCount;

  return {
    error,
    buckets,
    populatedBuckets: populated.length,
    bucketsOutOfTolerance: populated.filter((b) => !b.withinTolerance).map((b) => b.bucket),
  };
}
