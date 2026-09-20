import { contractById } from '../lib/dataset';
import { termsFor } from '@/lib/ai/term-library';
import type { ExtractionRun } from '../lib/extract';

/**
 * % of standard terms returned with a non-null value (spec 17 §2, ≥ 80%,
 * US-002). Measured over the terms the LIBRARY defines for the type, not over
 * the labels — a term the contract genuinely lacks still counts against
 * coverage, because the user sees an empty row either way. That is the metric
 * US-002 is about: how much of the panel is filled in.
 */
export function termCoverage(runs: ExtractionRun[]) {
  function score(filter: (run: ExtractionRun) => boolean) {
    const rows = runs.filter(filter);
    let valued = 0;
    let total = 0;
    for (const run of rows) {
      const contract = contractById(run.contract_id);
      const standard = termsFor(contract.contract_type).map((t) => t.term_name);
      total += standard.length;
      valued += standard.filter((name) => {
        const term = run.terms.find((t) => t.term_name === name);
        return term?.value != null && term.value.trim().length > 0;
      }).length;
    }
    return { valued, total, coverage: total === 0 ? null : valued / total };
  }

  return {
    overall: score(() => true),
    nda: score((r) => contractById(r.contract_id).contract_type === 'NDA'),
    msa: score((r) => contractById(r.contract_id).contract_type === 'MSA'),
  };
}
