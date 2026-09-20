import type { ChatQaPair } from '../lib/types';

/**
 * SYNTHETIC chat Q&A. Spec 17 §1 calls for 50 expert-labelled pairs from real
 * contracts; these are written against the synthetic corpus, so the labels are
 * correct by construction but the questions are ours, not an expert's.
 *
 * Three label classes, per spec 17 §1:
 *   grounded     — the answer is in the document and must cite the right page
 *   not-found    — the topic is absent; the correct answer is the refusal
 *   hallucinated — never a label we assign up front; it is what we MEASURE.
 *                  A not-found question answered with contract content, or a
 *                  grounded question answered with a value the contract does
 *                  not contain, is counted as hallucinated by the runner.
 *
 * The `history` class matters here for a specific reason: the live four-turn
 * memory test failed on exactly those turns while every unit test was green.
 * See eval/datasets/chat-memory.ts.
 */
export const CHAT_QA: ChatQaPair[] = [
  // --- grounded -----------------------------------------------------------
  { contract_id: 'nda-01', question: 'What is the governing law?', label: 'grounded', expected_page: 2, expected_contains: 'Delaware' },
  { contract_id: 'nda-01', question: 'How long does this agreement run for?', label: 'grounded', expected_page: 2, expected_contains: 'two' },
  { contract_id: 'nda-01', question: 'Who are the parties to this NDA?', label: 'grounded', expected_page: 1, expected_contains: 'Harborlight' },
  { contract_id: 'nda-02', question: 'Which courts have jurisdiction?', label: 'grounded', expected_page: 2, expected_contains: 'New York' },
  { contract_id: 'nda-02', question: 'What happens to intellectual property under this agreement?', label: 'grounded', expected_page: 2, expected_contains: 'disclosing party' },
  { contract_id: 'nda-03', question: 'What law governs this agreement?', label: 'grounded', expected_page: 2, expected_contains: 'England' },
  { contract_id: 'nda-03', question: 'Can the receiving party disclose if a court orders it?', label: 'grounded', expected_page: 2, expected_contains: 'court' },
  { contract_id: 'nda-05', question: 'How long does the confidentiality undertaking last?', label: 'grounded', expected_page: 1, expected_contains: 'eighteen' },
  { contract_id: 'msa-01', question: 'What is the liability cap?', label: 'grounded', expected_page: 2, expected_contains: 'twelve' },
  { contract_id: 'msa-01', question: 'When are invoices issued?', label: 'grounded', expected_page: 1, expected_contains: 'monthly' },
  { contract_id: 'msa-01', question: 'What are the payment terms?', label: 'grounded', expected_page: 1, expected_contains: 'thirty' },
  { contract_id: 'msa-01', question: 'How can this agreement be terminated?', label: 'grounded', expected_page: 2, expected_contains: 'sixty' },
  { contract_id: 'msa-02', question: 'What is the cap on liability?', label: 'grounded', expected_page: 2, expected_contains: '2,000,000' },
  { contract_id: 'msa-02', question: 'How must notices be delivered?', label: 'grounded', expected_page: 2, expected_contains: 'email' },
  { contract_id: 'msa-03', question: 'What is the limit of the supplier liability?', label: 'grounded', expected_page: 2, expected_contains: '1,000,000' },
  { contract_id: 'msa-03', question: 'How are disputes resolved?', label: 'grounded', expected_page: 2, expected_contains: 'adjudication' },
  { contract_id: 'msa-04', question: 'What notice is required to terminate?', label: 'grounded', expected_page: 2, expected_contains: 'six months' },
  { contract_id: 'msa-04', question: 'Who owns the deliverables?', label: 'grounded', expected_page: 2, expected_contains: 'Client' },

  // --- not-found: the topic is genuinely absent ---------------------------
  { contract_id: 'nda-01', question: 'What is the annual subscription fee?', label: 'not-found' },
  { contract_id: 'nda-01', question: 'How many support tickets are included per month?', label: 'not-found' },
  { contract_id: 'nda-02', question: 'What is the non-solicitation period?', label: 'grounded', expected_page: 2, expected_contains: 'twelve' },
  { contract_id: 'nda-03', question: 'What is the liability cap in this agreement?', label: 'not-found' },
  { contract_id: 'nda-03', question: 'Does this agreement contain a non-solicitation clause?', label: 'not-found' },
  { contract_id: 'nda-04', question: 'What are the payment terms?', label: 'not-found' },
  { contract_id: 'nda-05', question: 'What is the data retention period?', label: 'not-found' },
  { contract_id: 'nda-06', question: 'Which arbitration body hears disputes?', label: 'not-found' },
  { contract_id: 'msa-01', question: 'What is the uptime service level commitment?', label: 'not-found' },
  { contract_id: 'msa-02', question: 'What interest applies to late payments?', label: 'not-found' },
  { contract_id: 'msa-03', question: 'What indemnity does the supplier give?', label: 'not-found' },
  { contract_id: 'msa-04', question: 'How must formal notices be served?', label: 'not-found' },
];
