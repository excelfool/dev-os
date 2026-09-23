import { NDA_TERMS, MSA_TERMS } from './term-library';
import type { QueryClass } from '@/types/domain';

/**
 * Deterministic, zero-cost query classification (spec 08 §4). No extra API
 * call — the class only decides whether the document body is included.
 */

const HISTORY_SIGNAL =
  /\b(you (said|mentioned|told)|earlier|before|previous(ly)?|last (question|answer)|repeat that|what did you)\b/i;

/**
 * DEVIATION from spec 08 §4 rule 1 (2026-09-20). The spec's history regex is
 * written entirely in the second person — `you said`, `what did you`. A user
 * asking about the conversation in their OWN voice matched nothing:
 * "What have I asked you so far" — the lesson's own worked example — scored no
 * history signal, fell through to `contract`, was answered against the document
 * alone and came back "I cannot find this in the document."
 */
const HISTORY_SIGNAL_FIRST_PERSON =
  /\b((i|we) (have |had |just )?(asked|ask|said|mentioned|discussed|covered)|my (previous |earlier )?questions?|this (conversation|chat|session)|so far)\b/i;

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

/** A term-library name, a contract word or a contract stem. */
function hasContractSignal(text: string): boolean {
  const mentionsTerm = TERM_NAMES.some((name) => text.toLowerCase().includes(name));
  return mentionsTerm || CONTRACT_WORD.test(text) || CONTRACT_STEM.test(text);
}

export interface QueryAnalysis {
  queryClass: QueryClass;
  /** The message references the conversation itself (rule 1). */
  historySignal: boolean;
  /** The message names a contract term, word or stem (rule 2). */
  contractSignal: boolean;
}

export function classifyQuery(message: string, hasHistory: boolean): QueryClass {
  return analyseQuery(message, hasHistory).queryClass;
}

/**
 * The class plus the signals behind it, so callers that gate on a signal
 * (the query enhancer, spec 08 v1.1 §B / C28) read the same regexes rather
 * than duplicating them.
 */
export function analyseQuery(message: string, hasHistory: boolean): QueryAnalysis {
  const text = message.trim();
  const wordCount = text.split(/\s+/).filter(Boolean).length;

  const contractSignal = hasContractSignal(text);

  // A short bare back-reference with no contract noun is about the conversation.
  const historySignal =
    HISTORY_SIGNAL.test(text) ||
    HISTORY_SIGNAL_FIRST_PERSON.test(text) ||
    (wordCount < 8 && BARE_BACK_REFERENCE.test(text) && !contractSignal);

  const result = (queryClass: QueryClass): QueryAnalysis => ({ queryClass, historySignal, contractSignal });

  if (historySignal && contractSignal) return result('both');
  if (historySignal && hasHistory) return result('history');

  /**
   * DEVIATION from spec 08 §4 rule 3 (2026-09-20). The spec ends "Otherwise →
   * `contract` (the safe default: include the document)". Including the
   * document is not, on its own, safe: the `contract` prompt also orders the
   * model to answer ONLY from the document and to reply with the exact refusal
   * when it cannot. So every classifier miss on a conversational question does
   * not degrade — it refuses outright.
   *
   * When a message carries no contract signal and a conversation already
   * exists, the class is genuinely undecidable, and the safe answer is `both`:
   * document AND conversation, which costs nothing (history is sent for every
   * class) and lets a miss degrade instead of refusing. A message with a clear
   * contract signal still classifies `contract`, so the class stays meaningful
   * for the spec 17 evaluation.
   */
  if (!contractSignal && hasHistory) return result('both');

  return result('contract');
}

/**
 * Spec 08 v1.1 §B, as amended by C28 (2026-09-23): the enhancer runs whenever
 * the message carries no history signal — class `contract`, or `both` reached
 * only through the R10 fallback above (no contract signal, a conversation
 * exists). It never runs when a real history signal exists: a question about
 * the conversation keeps the user's own wording.
 */
export function shouldEnhanceQuery(analysis: QueryAnalysis): boolean {
  return !analysis.historySignal && analysis.queryClass !== 'history';
}

/** Spec 08 v1.1 §A step 5b, verbatim. */
const GREETING =
  /^(hi|hello|hey|yo|thanks|thank you|cheers|ok|okay|good (morning|afternoon|evening)|how are you)\b[\s!.?,]*(there|contractiq)?[\s!.?]*$/i;

const GREETING_MAX_WORDS = 6;

/**
 * Greeting / small-talk pre-check (spec 08 v1.1 §A step 5b): ≤ 6 words, the
 * spec's pattern, and no contract signal. A greeting is answered with a fixed
 * reply and never reaches the classifier, the enhancer, the document or the
 * model — PRD §7 "greetings … never touch the document store".
 */
export function isGreeting(message: string): boolean {
  const text = message.trim();
  if (text.split(/\s+/).filter(Boolean).length > GREETING_MAX_WORDS) return false;
  return GREETING.test(text) && !hasContractSignal(text);
}

/** The fixed greeting reply (spec 08 v1.1 §A step 5b), verbatim. */
export const GREETING_REPLY =
  "Hi — I'm ContractIQ. Ask me anything about this contract, for example: *Is there an auto-renewal clause?*";
