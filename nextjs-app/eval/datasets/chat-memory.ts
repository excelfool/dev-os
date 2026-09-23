/**
 * The conversational-memory set. This exists because of a specific failure:
 * Lab 2 Lesson 2's four-turn memory test failed live on both classification
 * turns while every unit test for the four query classes was green, because
 * those tests called `classifyQuery` directly and never reached the prompt the
 * model is actually sent.
 *
 * Each case is a SEQUENCE, not a single question, because the bug only appears
 * on a turn that depends on an earlier one. `expectRefusal: false` is the whole
 * point — the failure mode was the contract-path refusal being returned for a
 * question about the conversation.
 */
export interface MemoryCase {
  contract_id: string;
  name: string;
  turns: Array<{
    question: string;
    /** The class the deterministic classifier should assign. */
    expectedClass: 'contract' | 'history' | 'both';
    /** A correct answer here must never be the "cannot find" refusal. */
    expectRefusal: boolean;
    expectedContains?: string;
    /**
     * Stage 5 chat item (2026-09-23): the answer must not be the previous
     * assistant answer repeated verbatim — "summarize" on the `both` path used
     * to hand back the prior answer unchanged instead of summarising.
     */
    mustNotRepeatPrevious?: boolean;
  }>;
}

export const MEMORY_CASES: MemoryCase[] = [
  {
    contract_id: 'nda-01',
    name: 'demonstrative follow-up (T2 of the live failure)',
    turns: [
      { question: 'What is the governing law', expectedClass: 'contract', expectRefusal: false, expectedContains: 'Delaware' },
      // L17 (2026-09-23): a bare back-reference now routes to `both` — the document is included.
      { question: 'What does that mean in practice?', expectedClass: 'both', expectRefusal: false },
    ],
  },
  {
    contract_id: 'nda-01',
    name: 'first-person recall (T4 of the live failure)',
    turns: [
      { question: 'What is the governing law', expectedClass: 'contract', expectRefusal: false, expectedContains: 'Delaware' },
      { question: 'What have I asked you so far', expectedClass: 'history', expectRefusal: false, expectedContains: 'governing law' },
    ],
  },
  {
    contract_id: 'msa-01',
    name: 'history and contract together',
    turns: [
      { question: 'What is the liability cap?', expectedClass: 'contract', expectRefusal: false },
      { question: 'what did you say earlier about indemnity?', expectedClass: 'both', expectRefusal: false },
    ],
  },
  {
    contract_id: 'msa-01',
    name: 'undecidable follow-up must not refuse',
    turns: [
      { question: 'What are the payment terms?', expectedClass: 'contract', expectRefusal: false },
      { question: 'and in plain English', expectedClass: 'both', expectRefusal: false },
    ],
  },
  {
    contract_id: 'msa-01',
    name: '"summarize" on the both path is a summary, not the prior answer again',
    turns: [
      { question: 'What are the payment terms?', expectedClass: 'contract', expectRefusal: false },
      // No contract signal, a conversation exists ⇒ `both` through the R10 fallback.
      { question: 'summarize', expectedClass: 'both', expectRefusal: false, mustNotRepeatPrevious: true },
    ],
  },
  {
    contract_id: 'nda-03',
    name: 'a genuinely absent topic still refuses',
    turns: [
      { question: 'What is the governing law', expectedClass: 'contract', expectRefusal: false },
      { question: 'What is the liability cap in this agreement?', expectedClass: 'contract', expectRefusal: true },
    ],
  },
];
