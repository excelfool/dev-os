import { ALL_CONTRACTS, contractById } from '../lib/dataset';
import { matchValues, type MatcherVersion, type MatchRule } from '../lib/matching';
import type { ExtractionRun } from '../lib/extract';
import type { ReportRow } from '../lib/types';

/**
 * Precision / Recall / F1 against the labelled set (spec 17 §2).
 *
 * A term is a true positive when the value matches AND ground truth had a
 * value; a value produced where ground truth has none is a false positive; a
 * null where ground truth has a value is a false negative. A value that is
 * present but WRONG counts as both — it is a false positive (we asserted
 * something untrue) and a false negative (we missed the truth), which is what
 * makes F1 punish a confident wrong answer harder than an honest null.
 */

export interface TermOutcome {
  contract_id: string;
  contract_type: 'NDA' | 'MSA';
  term_name: string;
  expected: string | null;
  actual: string | null;
  expectedPage: number | null;
  actualPage: number | null;
  confidence: number;
  outcome: 'tp' | 'fp' | 'fn' | 'tn' | 'wrong';
  /** Which matcher rule produced a true positive; 'none' otherwise. */
  rule: MatchRule;
}

export interface F1Result {
  precision: number;
  recall: number;
  f1: number;
  tp: number;
  fp: number;
  fn: number;
  tn: number;
}

export function classifyTerms(runs: ExtractionRun[], matcher: MatcherVersion = 'v2'): TermOutcome[] {
  const outcomes: TermOutcome[] = [];

  for (const run of runs) {
    const contract = contractById(run.contract_id);
    for (const expected of contract.terms) {
      const actual = run.terms.find((t) => t.term_name === expected.term_name);
      const actualValue = actual?.value ?? null;

      let outcome: TermOutcome['outcome'];
      let rule: MatchRule = 'none';
      if (expected.expected_value === null && actualValue === null) outcome = 'tn';
      else if (expected.expected_value === null && actualValue !== null) outcome = 'fp';
      else if (expected.expected_value !== null && actualValue === null) outcome = 'fn';
      else {
        const match = matchValues(expected.expected_value!, actualValue!, matcher);
        rule = match.rule;
        outcome = match.matched ? 'tp' : 'wrong';
      }

      outcomes.push({
        contract_id: run.contract_id,
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

  return outcomes;
}

export function scoreF1(outcomes: TermOutcome[]): F1Result {
  const tp = outcomes.filter((o) => o.outcome === 'tp').length;
  const tn = outcomes.filter((o) => o.outcome === 'tn').length;
  const wrong = outcomes.filter((o) => o.outcome === 'wrong').length;
  const fp = outcomes.filter((o) => o.outcome === 'fp').length + wrong;
  const fn = outcomes.filter((o) => o.outcome === 'fn').length + wrong;

  const precision = tp + fp === 0 ? 1 : tp / (tp + fp);
  const recall = tp + fn === 0 ? 1 : tp / (tp + fn);
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);

  return { precision, recall, f1, tp, fp, fn, tn };
}

export function extractionF1(runs: ExtractionRun[], matcher: MatcherVersion = 'v2') {
  const outcomes = classifyTerms(runs, matcher);
  return {
    outcomes,
    overall: scoreF1(outcomes),
    nda: scoreF1(outcomes.filter((o) => o.contract_type === 'NDA')),
    msa: scoreF1(outcomes.filter((o) => o.contract_type === 'MSA')),
    /** Per-term-name breakdown, so a failure is reportable per term. */
    /** How many true positives each matcher rule accounted for. */
    byRule: Object.fromEntries(
      [...new Set(outcomes.filter((o) => o.outcome === 'tp').map((o) => o.rule))].map((rule) => [
        rule,
        outcomes.filter((o) => o.outcome === 'tp' && o.rule === rule).length,
      ]),
    ),
    byTerm: Object.fromEntries(
      [...new Set(outcomes.map((o) => o.term_name))].map((name) => [
        name,
        scoreF1(outcomes.filter((o) => o.term_name === name)),
      ]),
    ),
  };
}

export function toReportRows(outcomes: TermOutcome[], promptVersion: string): ReportRow[] {
  return outcomes.map((o) => ({
    Contract_ID: o.contract_id,
    Contract_Type: o.contract_type,
    Term_Name: o.term_name,
    Expected_Value: o.expected ?? '',
    AI_Extracted_Value: o.actual ?? '',
    Expected_Page: o.expectedPage === null ? '' : String(o.expectedPage),
    AI_Page: o.actualPage === null ? '' : String(o.actualPage),
    Confidence_Score: String(o.confidence),
    F1_Match: o.outcome === 'tp' || o.outcome === 'tn' ? 'TRUE' : 'FALSE',
    Expert_Rating: '',
    Notes: o.outcome === 'tp' ? `tp:${o.rule}` : o.outcome,
    Prompt_Version: promptVersion,
  }));
}

export const CONTRACT_COUNT = ALL_CONTRACTS.length;
