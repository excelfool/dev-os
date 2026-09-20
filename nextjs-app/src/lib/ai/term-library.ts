import type { ContractType } from '@/types/domain';

/**
 * The versioned, server-side term library (spec 05 §1) — what makes extraction
 * contract-type-specific. Static typed code: no DB table, no runtime fetch.
 *
 * Growth path (A-11): the PRD's "20–30 terms that actually matter" is reached
 * by appending entries with display_rank > 12. Nothing in the schema, the API
 * or the UI changes — the extra terms land under "Show all terms".
 */

export interface StandardTerm {
  /** Exact string sent to the model and stored in key_terms.term_name. */
  term_name: string;
  /** ≤ 12 => expanded by default on the results page. */
  display_rank: number;
  /** Plain-English explanation, WCAG-required (spec 16 §4 item 8). */
  tooltip: string;
  /** One line appended to the prompt's target list to disambiguate. */
  guidance: string;
}

export const TERM_LIBRARY_VERSION = 'v1.0';

export const NDA_TERMS: StandardTerm[] = [
  {
    term_name: 'Parties',
    display_rank: 1,
    tooltip: 'Who is bound by this agreement.',
    guidance: 'Full legal names of every party, including entity type.',
  },
  {
    term_name: 'Effective Date',
    display_rank: 2,
    tooltip: 'The date the agreement starts.',
    guidance: 'The stated commencement or signature date.',
  },
  {
    term_name: 'Confidentiality Obligations',
    display_rank: 3,
    tooltip: 'What you must keep secret and how.',
    guidance: 'The core duty of non-disclosure and the standard of care.',
  },
  {
    term_name: 'Permitted Disclosures',
    display_rank: 4,
    tooltip: 'When you are allowed to share the information.',
    guidance: 'Carve-outs such as legal compulsion, advisors, prior knowledge.',
  },
  {
    term_name: 'Term & Duration',
    display_rank: 5,
    tooltip: 'How long the agreement and the secrecy duty last.',
    guidance: 'Both the agreement term and any survival period.',
  },
  {
    term_name: 'Governing Law',
    display_rank: 6,
    tooltip: "Which country's or state's law applies.",
    guidance: 'The named governing law.',
  },
  {
    term_name: 'Jurisdiction',
    display_rank: 7,
    tooltip: 'Which courts decide a dispute.',
    guidance: 'The named forum or exclusive jurisdiction.',
  },
  {
    term_name: 'IP Ownership',
    display_rank: 8,
    tooltip: 'Who owns the ideas and materials shared.',
    guidance: 'Ownership and any licence granted.',
  },
  {
    term_name: 'Non-Solicitation',
    display_rank: 9,
    tooltip: "Whether you may hire or approach the other side's people or clients.",
    guidance: 'Scope and duration of any non-solicit.',
  },
  {
    term_name: 'Breach & Remedy',
    display_rank: 10,
    tooltip: 'What happens if the agreement is broken.',
    guidance: 'Remedies, injunctive relief, damages, cure periods.',
  },
];

export const MSA_TERMS: StandardTerm[] = [
  {
    term_name: 'Parties',
    display_rank: 1,
    tooltip: 'Who is bound by this agreement.',
    guidance: 'Full legal names of every party.',
  },
  {
    term_name: 'Service Scope',
    display_rank: 2,
    tooltip: 'What work is being delivered.',
    guidance: 'The described services or statement-of-work reference.',
  },
  {
    term_name: 'Payment Terms',
    display_rank: 3,
    tooltip: 'How much you are paid or owe, and when.',
    guidance: 'Rates, fees and payment window (e.g. net 30).',
  },
  {
    term_name: 'Invoice Schedule',
    display_rank: 4,
    tooltip: 'How often invoices are issued.',
    guidance: 'Invoicing cadence and submission requirements.',
  },
  {
    term_name: 'Late Payment Penalty',
    display_rank: 5,
    tooltip: 'What happens if payment is late.',
    guidance: 'Interest rate or fixed penalty for late payment.',
  },
  {
    term_name: 'Liability Cap',
    display_rank: 6,
    tooltip: 'The most either side can be made to pay.',
    guidance: 'The stated cap, its basis and any exclusions.',
  },
  {
    term_name: 'Indemnification',
    display_rank: 7,
    tooltip: "Who covers the other's losses, and for what.",
    guidance: 'Indemnity triggers and scope.',
  },
  {
    term_name: 'IP Ownership',
    display_rank: 8,
    tooltip: 'Who owns what is created under the contract.',
    guidance: 'Ownership of deliverables, background and foreground IP.',
  },
  {
    term_name: 'Termination Clause',
    display_rank: 9,
    tooltip: 'How and when either side can end the contract.',
    guidance: 'Termination for convenience and for cause.',
  },
  {
    term_name: 'Governing Law',
    display_rank: 10,
    tooltip: "Which country's or state's law applies.",
    guidance: 'The named governing law.',
  },
  {
    term_name: 'Dispute Resolution',
    display_rank: 11,
    tooltip: 'How disagreements are settled.',
    guidance: 'Negotiation, mediation, arbitration or litigation path.',
  },
  {
    term_name: 'Notice Period',
    display_rank: 12,
    tooltip: 'How much warning is required before ending or changing things.',
    guidance: 'The stated notice period and delivery method.',
  },
];

export function termsFor(type: ContractType): StandardTerm[] {
  return type === 'NDA' ? NDA_TERMS : MSA_TERMS;
}

/** 99 for an unknown or custom term — they sort under "Show all terms". */
export function displayRankFor(type: ContractType, termName: string): number {
  const match = termsFor(type).find(
    (t) => t.term_name.toLowerCase() === termName.trim().toLowerCase(),
  );
  return match?.display_rank ?? 99;
}

export function isStandardTerm(type: ContractType, termName: string): boolean {
  return termsFor(type).some(
    (t) => t.term_name.toLowerCase() === termName.trim().toLowerCase(),
  );
}
