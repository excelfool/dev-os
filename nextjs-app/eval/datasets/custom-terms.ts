import type { LabelledTerm } from '../lib/types';

/**
 * Custom terms injected into contracts that contain the answer, per spec 17 §1
 * (10 predefined custom terms across the corpus). Synthetic, like the rest.
 */
export const CUSTOM_TERM_CASES: Array<{
  contract_id: string;
  custom_terms: LabelledTerm[];
}> = [
  { contract_id: 'nda-01', custom_terms: [{ term_name: 'Survival period', expected_value: 'three (3) years after termination', expected_page: 2 }] },
  { contract_id: 'nda-02', custom_terms: [{ term_name: 'Survival period', expected_value: 'three (3) years after termination', expected_page: 2 }] },
  { contract_id: 'nda-03', custom_terms: [{ term_name: 'Termination notice', expected_value: "thirty days' written notice", expected_page: 2 }] },
  { contract_id: 'nda-05', custom_terms: [{ term_name: 'Purpose of disclosure', expected_value: 'to evaluate the proposed transaction', expected_page: 1 }] },
  { contract_id: 'msa-01', custom_terms: [{ term_name: 'Arbitration venue', expected_value: 'San Francisco', expected_page: 2 }] },
  { contract_id: 'msa-01', custom_terms: [{ term_name: 'Late payment interest', expected_value: '1.5% per month', expected_page: 1 }] },
  { contract_id: 'msa-02', custom_terms: [{ term_name: 'Mediation venue', expected_value: 'Dallas, Texas', expected_page: 2 }] },
  { contract_id: 'msa-02', custom_terms: [{ term_name: 'Cure period', expected_value: 'thirty (30) days', expected_page: 2 }] },
  { contract_id: 'msa-03', custom_terms: [{ term_name: 'Insolvency termination', expected_value: 'immediately on insolvency', expected_page: 2 }] },
  { contract_id: 'msa-04', custom_terms: [{ term_name: 'Escalation route', expected_value: 'their respective directors', expected_page: 2 }] },
];
