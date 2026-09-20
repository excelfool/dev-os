import { NDA_CORPUS } from '../datasets/nda-corpus';
import { MSA_CORPUS } from '../datasets/msa-corpus';
import { CUSTOM_TERM_CASES } from '../datasets/custom-terms';
import type { DatasetProvenance, LabelledContract } from './types';

export const ALL_CONTRACTS: LabelledContract[] = [...NDA_CORPUS, ...MSA_CORPUS];

export function contractById(id: string): LabelledContract {
  const found = ALL_CONTRACTS.find((c) => c.contract_id === id);
  if (!found) throw new Error(`Unknown contract in dataset: ${id}`);
  return found;
}

export function customTermsFor(contractId: string): string[] {
  return CUSTOM_TERM_CASES.filter((c) => c.contract_id === contractId).flatMap((c) =>
    c.custom_terms.map((t) => t.term_name),
  );
}

export function pageCountOf(contract: LabelledContract): number {
  return [...contract.text.matchAll(/^\[PAGE (\d+)\]$/gm)].length;
}

/**
 * Spec 17 §3 requires dataset provenance in the summary, and A-15 requires the
 * reduced confidence to be recorded when no SME annotation exists. It does not
 * here: nothing in eval/datasets/ is SME-annotated or from CUAD.
 */
export const PROVENANCE: DatasetProvenance = 'synthetic';

export const PROVENANCE_NOTE =
  'Synthetic corpus authored alongside the harness. NOT SME-annotated and NOT CUAD. ' +
  'Ground truth is correct by construction because the prose was written around the ' +
  'values, but the contracts are ours, so these figures measure the pipeline against ' +
  'our own labels and are not the launch-gate evidence spec 18 §4 calls for.';
