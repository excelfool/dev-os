/** Label file schema, spec 17 §1. */
export interface LabelledTerm {
  term_name: string;
  /** null means the term is genuinely absent from this contract. */
  expected_value: string | null;
  expected_page: number | null;
}

export interface LabelledContract {
  contract_id: string;
  contract_type: 'NDA' | 'MSA';
  /** Optional, drives the monthly fairness segmentation (spec 17 §1). */
  jurisdiction?: string;
  industry?: string;
  terms: LabelledTerm[];
  /** Custom terms injected for the custom-term-f1 runner (spec 17 §1). */
  custom_terms?: LabelledTerm[];
  /** The contract text, with [PAGE N] markers, as extract-text would emit. */
  text: string;
}

export interface ChatQaPair {
  contract_id: string;
  question: string;
  /** Expert label, spec 17 §1. */
  label: 'grounded' | 'hallucinated' | 'not-found';
  /** For grounded answers, a page the answer must cite. */
  expected_page?: number;
  /** Substring the answer must contain to count as correct on the facts. */
  expected_contains?: string;
}

export type DatasetProvenance = 'sme-annotated' | 'cuad-only' | 'synthetic';

export interface GateResult {
  gate: string;
  metric: string;
  value: number | null;
  threshold: number;
  comparison: 'gte' | 'lte';
  passed: boolean | null;
}

/** One row of eval/reports/<release>.csv — exactly the PRD's columns plus one. */
export interface ReportRow {
  Contract_ID: string;
  Contract_Type: string;
  Term_Name: string;
  Expected_Value: string;
  AI_Extracted_Value: string;
  Expected_Page: string;
  AI_Page: string;
  Confidence_Score: string;
  F1_Match: string;
  Expert_Rating: string;
  Notes: string;
  Prompt_Version: string;
}
