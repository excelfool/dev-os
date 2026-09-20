import type { TermOutcome } from './extraction-f1';

/**
 * % of terms whose page_number matches ground truth (spec 17 §2, target ≥ 92%).
 * Scored only over terms the model actually returned a value for — a page is
 * not wrong when there is nothing on it to cite.
 */
export function pageAccuracy(outcomes: TermOutcome[]) {
  const scored = outcomes.filter((o) => o.expectedPage !== null && o.actual !== null);
  const correct = scored.filter((o) => o.actualPage === o.expectedPage);

  const byTerm = Object.fromEntries(
    [...new Set(scored.map((o) => o.term_name))].map((name) => {
      const rows = scored.filter((o) => o.term_name === name);
      return [name, { total: rows.length, correct: rows.filter((r) => r.actualPage === r.expectedPage).length }];
    }),
  );

  return {
    accuracy: scored.length === 0 ? null : correct.length / scored.length,
    scored: scored.length,
    correct: correct.length,
    byTerm,
    misses: scored
      .filter((o) => o.actualPage !== o.expectedPage)
      .map((o) => ({ contract: o.contract_id, term: o.term_name, expected: o.expectedPage, actual: o.actualPage })),
  };
}
