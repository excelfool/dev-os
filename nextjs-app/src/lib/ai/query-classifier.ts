import { NDA_TERMS, MSA_TERMS } from './term-library';
import type { QueryClass } from '@/types/domain';

/**
 * Deterministic, zero-cost query classification (spec 08 §4). No extra API
 * call — the class only decides whether the document body is included.
 */

const HISTORY_SIGNAL =
  /\b(you (said|mentioned|told)|earlier|before|previous(ly)?|last (question|answer)|repeat that|what did you)\b/i;

/**
 * DEVIATION from spec 08 §4. The spec writes one alternation wrapped in
 * `\b(...)\b`, which mixes whole words with prefix stems — and a trailing `\b`
 * makes every stem unmatchable: `terminat\b` cannot match "termination",
 * `indemnif\b` cannot match "indemnification". All three stems in the spec's
 * regex (`terminat`, `indemnif`, `renew`) were therefore dead, so a question
 * like the spec's own §8 example — "what did you say earlier about indemnity?"
 * — classified as `history` and had the document body omitted from a question
 * that needed it.
 *
 * Split into two regexes: whole words keep both boundaries, stems keep only the
 * leading one. `indemnif` is also widened to `indemni` so "indemnity" matches.
 */
const CONTRACT_WORD =
  /\b(clause|contract|agreement|nda|msa|page|section|party|parties|liability|payment|governing law|confidential|notice)\b/i;

const CONTRACT_STEM = /\b(terminat|indemni|renew)/i;

const BARE_BACK_REFERENCE = /\b(that|it|those)\b/i;

const TERM_NAMES = [...NDA_TERMS, ...MSA_TERMS].map((t) => t.term_name.toLowerCase());

export function classifyQuery(message: string, hasHistory: boolean): QueryClass {
  const text = message.trim();
  const wordCount = text.split(/\s+/).filter(Boolean).length;

  const mentionsTerm = TERM_NAMES.some((name) => text.toLowerCase().includes(name));
  const contractSignal = mentionsTerm || CONTRACT_WORD.test(text) || CONTRACT_STEM.test(text);

  // A short bare back-reference with no contract noun is about the conversation.
  const historySignal =
    HISTORY_SIGNAL.test(text) || (wordCount < 8 && BARE_BACK_REFERENCE.test(text) && !contractSignal);

  if (historySignal && contractSignal) return 'both';
  if (historySignal && hasHistory) return 'history';

  // The safe default is to include the document.
  return 'contract';
}
