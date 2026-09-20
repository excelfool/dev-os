/**
 * The per-deploy hallucination regression test (spec 17 §1, §5). Every question
 * here is about a topic the contract does not mention at all. The only correct
 * answer is the exact refusal; anything else is a hallucination and blocks the
 * deploy.
 */
export const HALLUCINATION_PROBES: Array<{ contract_id: string; question: string }> = [
  { contract_id: 'nda-01', question: 'What is the monthly service credit for downtime?' },
  { contract_id: 'nda-01', question: 'Which insurer provides the professional indemnity cover?' },
  { contract_id: 'nda-02', question: 'What is the agreed exchange rate for cross-border payments?' },
  { contract_id: 'nda-03', question: 'How many named users are licensed?' },
  { contract_id: 'nda-04', question: 'What is the penalty for late delivery of the milestones?' },
  { contract_id: 'nda-05', question: 'Which sub-processors are approved under this agreement?' },
  { contract_id: 'nda-06', question: 'What is the agreed annual price increase cap?' },
  { contract_id: 'msa-01', question: 'What is the disaster recovery point objective?' },
  { contract_id: 'msa-02', question: 'Which employees are named as key personnel?' },
  { contract_id: 'msa-03', question: 'What is the agreed social value commitment percentage?' },
  { contract_id: 'msa-04', question: 'What is the maximum number of concurrent sessions permitted?' },
  { contract_id: 'msa-04', question: 'Which third-party audit standard applies?' },
];
