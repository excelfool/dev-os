import type { GuardrailPattern } from './types';

/**
 * `stay_within_contract` (spec 13 v1.1 §A, PRD rule 3). Generic requests that
 * are not about the contract. Only consulted when the message carries no
 * contract signal and no history signal, so "write a summary of this
 * contract" is never off-scope.
 */
export const OFF_SCOPE_PATTERNS: GuardrailPattern[] = [
  {
    id: 'off_scope.draft',
    pattern: /\b(draft me|draft an?|write (?:me )?an?)\b/i,
    example: 'Write a poem about the sea.',
  },
  {
    id: 'off_scope.general_law',
    pattern: /\bwhat(?:'s| is) the law (?:in|on|about)\b/i,
    example: 'What is the law in France on inheritance?',
  },
  {
    id: 'off_scope.trivia',
    pattern: /\b(capital of|who is the (?:current )?president|who won the)\b/i,
    example: 'What is the capital of Peru?',
  },
];
