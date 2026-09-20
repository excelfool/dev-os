import { CUSTOM_TERM_CASES } from '../datasets/custom-terms';
import { matchValues, type MatcherVersion, type MatchRule } from '../lib/matching';
import { scoreF1, type TermOutcome } from './extraction-f1';
import { contractById } from '../lib/dataset';
import type { ExtractionRun } from '../lib/extract';

/** F1 over the injected custom terms (spec 17 §2, target ≥ 80%). */
export function customTermF1(runs: ExtractionRun[], matcher: MatcherVersion = 'v2') {
  const outcomes: TermOutcome[] = [];

  for (const testCase of CUSTOM_TERM_CASES) {
    const run = runs.find((r) => r.contract_id === testCase.contract_id);
    if (!run) continue;
    const contract = contractById(testCase.contract_id);

    for (const expected of testCase.custom_terms) {
      const actual = run.terms.find(
        (t) => t.term_name.toLowerCase() === expected.term_name.toLowerCase(),
      );
      const actualValue = actual?.value ?? null;

      let outcome: TermOutcome['outcome'];
      let rule: MatchRule = 'none';
      if (expected.expected_value === null && actualValue === null) outcome = 'tn';
      else if (expected.expected_value === null) outcome = 'fp';
      else if (actualValue === null) outcome = 'fn';
      else {
        const match = matchValues(expected.expected_value, actualValue, matcher);
        rule = match.rule;
        outcome = match.matched ? 'tp' : 'wrong';
      }

      outcomes.push({
        contract_id: testCase.contract_id,
        contract_type: contract.contract_type,
        term_name: expected.term_name,
        expected: expected.expected_value,
        actual: actualValue,
        expectedPage: expected.expected_page,
        actualPage: actual?.page_number ?? null,
        confidence: actual?.confidence_score ?? 0,
        outcome,
        rule,
      });
    }
  }

  return { outcomes, score: scoreF1(outcomes) };
}
