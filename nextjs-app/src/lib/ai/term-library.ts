import type { ContractType } from '@/types/domain';
import msaInstructor from './term-library/msa-instructor.json';

/**
 * The versioned, server-side term library (spec 05 §1, v1.1 §A) — what makes
 * extraction contract-type-specific. Static typed code: no DB table, no
 * runtime fetch.
 *
 * MSA_TERMS is generated from the instructor's key-term file
 * (docs/reference/key-terms-msa-instructor.json, synced into this directory by
 * `npm run eval:sync-refs`; a unit test asserts the copy is byte-identical), so
 * term_name, question, answer_format and display_rank can never drift from it.
 */

export interface StandardTerm {
  /** Instructor id (MSA) or 1–10 (NDA); stable across renames. */
  term_id: number;
  /** Exact string sent to the model and stored in key_terms.term_name. */
  term_name: string;
  /** The question the extraction prompt asks (PRD R-21c). */
  question: string;
  /** The constraint appended to the question. */
  answer_format: string;
  /** ≤ 12 => expanded by default on the results page. */
  display_rank: number;
  /** Plain-English explanation, WCAG-required (spec 16 §4 item 8). */
  tooltip: string;
  /** "Required field not found ⇒ flag for review" (spec 06 v1.1 §C). */
  is_required: boolean;
  /** NDA only: the v1.0 disambiguation line, kept for extraction.v1. */
  guidance?: string;
}

/** Stamped on every persisted term as `term_library_version`. */
export const TERM_LIBRARY_VERSION = 'v1.1';
/** The instructor file the MSA library is generated from. */
export const MSA_LIBRARY_SOURCE_VERSION = msaInstructor.version;

export const DEFAULT_ANSWER_FORMAT = 'verbatim clause text or short summary, or N/A';

const NDA_REQUIRED = new Set(['Parties', 'Effective Date']);

function ndaTerm(
  term_id: number,
  term_name: string,
  tooltip: string,
  guidance: string,
  answer_format: string = DEFAULT_ANSWER_FORMAT,
): StandardTerm {
  return {
    term_id,
    term_name,
    // Spec 05 v1.1 §B: the question is "What is the {term_name}?" carrying the
    // existing guidance, so one prompt path serves both contract types.
    question: `What is the ${term_name}? ${guidance}`,
    answer_format,
    display_rank: term_id,
    tooltip,
    is_required: NDA_REQUIRED.has(term_name),
    guidance,
  };
}

export const NDA_TERMS: StandardTerm[] = [
  ndaTerm(1, 'Parties', 'Who is bound by this agreement.', 'Full legal names of every party, including entity type.'),
  ndaTerm(2, 'Effective Date', 'The date the agreement starts.', 'The stated commencement or signature date.', 'date (YYYY-MM-DD), or N/A'),
  ndaTerm(3, 'Confidentiality Obligations', 'What you must keep secret and how.', 'The core duty of non-disclosure and the standard of care.'),
  ndaTerm(4, 'Permitted Disclosures', 'When you are allowed to share the information.', 'Carve-outs such as legal compulsion, advisors, prior knowledge.'),
  ndaTerm(5, 'Term & Duration', 'How long the agreement and the secrecy duty last.', 'Both the agreement term and any survival period.'),
  ndaTerm(6, 'Governing Law', "Which country's or state's law applies.", 'The named governing law.', 'name of jurisdiction only'),
  ndaTerm(7, 'Jurisdiction', 'Which courts decide a dispute.', 'The named forum or exclusive jurisdiction.'),
  ndaTerm(8, 'IP Ownership', 'Who owns the ideas and materials shared.', 'Ownership and any licence granted.'),
  ndaTerm(9, 'Non-Solicitation', "Whether you may hire or approach the other side's people or clients.", 'Scope and duration of any non-solicit.'),
  ndaTerm(10, 'Breach & Remedy', 'What happens if the agreement is broken.', 'Remedies, injunctive relief, damages, cure periods.'),
];

/** Spec 05 v1.1 §B — tooltips and the required set, keyed by instructor term_id. */
const MSA_TOOLTIPS: Record<number, string> = {
  1: 'The company providing the services.',
  2: 'The company buying the services.',
  3: 'When the agreement begins.',
  4: 'When the agreement ends unless renewed.',
  5: 'How long the agreement runs, in months.',
  6: 'The total amount the customer pays.',
  7: "Which country's or state's law applies.",
  8: 'Whether the agreement renews by itself.',
  9: 'How much warning is needed to end the agreement.',
  10: 'How quickly a data breach must be reported.',
  11: 'How often you are invoiced.',
  12: 'How long each renewal lasts.',
  13: 'How many days before renewal you must object.',
  14: 'How many days you have to pay an invoice.',
  15: 'Whether a serious breach lets a party end the agreement.',
  16: 'Whether a stated reason lets a party end the agreement.',
  17: 'Whether a party can end the agreement with no reason.',
  18: 'Whether a party can simply choose to end the agreement.',
  19: 'Warning needed to end the agreement for convenience.',
  20: 'Whether late invoices attract charges.',
  21: 'How late-payment charges are calculated.',
  22: 'The most either side can be made to pay.',
  23: 'Whether the provider needs your consent to hand the contract to someone else.',
  24: 'Whether the provider may use your name and logo.',
  25: 'Whether your data must be deleted on request or at the end.',
  26: 'What losses you must cover for the provider.',
  27: 'What losses the provider must cover for you.',
  28: 'Whether you must give notice to claim indemnity.',
  29: 'Whether legal fees are covered by the indemnity.',
  30: 'Whether the provider can raise prices.',
  31: 'How much warning you get before a price rise.',
  32: 'What insurance the agreement requires.',
  33: 'Whether insurance must be kept for the whole term.',
  34: 'Warning required for insurance changes.',
  35: 'What the provider owns.',
  36: 'What you own.',
};
const MSA_REQUIRED = new Set([1, 2, 3]);

export const MSA_TERMS: StandardTerm[] = [...msaInstructor.terms]
  .sort((a, b) => a.display_rank - b.display_rank)
  .map((t) => {
    const tooltip = MSA_TOOLTIPS[t.term_id];
    if (!tooltip) throw new Error(`No tooltip for instructor MSA term ${t.term_id} (${t.term_name})`);
    return {
      term_id: t.term_id,
      term_name: t.term_name,
      question: t.question,
      answer_format: t.answer_format,
      display_rank: t.display_rank,
      tooltip,
      is_required: MSA_REQUIRED.has(t.term_id),
    };
  });

export function termsFor(type: ContractType): StandardTerm[] {
  return type === 'NDA' ? NDA_TERMS : MSA_TERMS;
}

function findTerm(type: ContractType, termName: string): StandardTerm | undefined {
  const needle = termName.trim().toLowerCase();
  return termsFor(type).find((t) => t.term_name.toLowerCase() === needle);
}

/** 99 for an unknown or custom term — they sort under "Show all terms". */
export function displayRankFor(type: ContractType, termName: string): number {
  return findTerm(type, termName)?.display_rank ?? 99;
}

export function isStandardTerm(type: ContractType, termName: string): boolean {
  return findTerm(type, termName) !== undefined;
}

export function isRequiredTerm(type: ContractType, termName: string): boolean {
  return findTerm(type, termName)?.is_required ?? false;
}

/** The names a results page flags as required-but-missing (spec 06 v1.1 §C). */
export function requiredMissingNames(
  type: ContractType,
  terms: Array<{ term_name: string; value: string | null; is_custom?: boolean }>,
): string[] {
  return terms
    .filter((t) => !t.is_custom && t.value === null && isRequiredTerm(type, t.term_name))
    .map((t) => t.term_name);
}
