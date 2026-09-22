import { APPLICABLE_CODES, HHH_CODES, type HhhSubjectType } from './hhh-codes';

/**
 * Reading saved HHH scores back into Review mode (L14, spec 22 §4).
 *
 * Review mode used to open blank after a refresh. That was not merely
 * cosmetic: route 32 writes **every** applicable column on each save, so
 * answering one question on a blank form wrote NULL over every stored answer.
 * The reviewer's work vanished with no error and no way to notice. Hydration
 * is the fix, and this module is the mapping it rests on.
 *
 * Pure, and free of `server-only`: the page loads the rows on the server and
 * the questionnaire renders them on the client.
 */

export interface StoredVerdicts {
  helpful_verdict: string;
  honest_verdict: string;
  harmless_verdict: string;
}

/**
 * One saved row, as the columns come back from PostgREST. The 29 answer
 * columns arrive under their lower-case names, so they are reached through the
 * index signature rather than listed one by one.
 */
export interface HhhScoreRow extends StoredVerdicts {
  id: string;
  subject_type: HhhSubjectType;
  term_id: string | null;
  message_id: string | null;
  notes: string | null;
  /** `h1`…`a9`: `true` = Yes, `false` = No, `null` = Skip. */
  [column: string]: unknown;
}

export interface StoredScore {
  key: string;
  subjectType: HhhSubjectType;
  termId: string | null;
  /** Code → the reviewer's answer. `null` is a real answer: Skip. */
  answers: Record<string, boolean | null>;
  notes: string;
  verdicts: StoredVerdicts;
}

/** The select list for the hydration query. */
export const HHH_SCORE_COLUMNS = [
  'id',
  'subject_type',
  'term_id',
  'message_id',
  'notes',
  'helpful_verdict',
  'honest_verdict',
  'harmless_verdict',
  ...HHH_CODES.map((c) => c.column),
].join(', ');

/**
 * The identity of a scored subject. A term and a message could share an id
 * value, so the type is part of the key; the summary needs no id because a
 * contract has exactly one.
 */
export function subjectKey(subject: {
  subject_type: HhhSubjectType;
  term_id?: string | null;
  message_id?: string | null;
}): string {
  if (subject.subject_type === 'term') return `term:${subject.term_id}`;
  if (subject.subject_type === 'message') return `message:${subject.message_id}`;
  return subject.subject_type;
}

/**
 * One row into the state a questionnaire opens with.
 *
 * Only the codes this subject type is asked are carried: a message row still
 * has 29 columns in the table, but sending `H11` back would be a code the
 * subject is never asked, and route 32 rejects those.
 */
export function toStoredScore(row: HhhScoreRow): StoredScore {
  const subjectType = row.subject_type;
  const answers: Record<string, boolean | null> = {};
  for (const code of APPLICABLE_CODES[subjectType]) {
    const column = code.toLowerCase();
    // Present-but-null is meaningful — it is how Skip renders as chosen.
    answers[code] = (row[column] as boolean | null | undefined) ?? null;
  }

  return {
    key: subjectKey(row),
    subjectType,
    termId: row.term_id ?? null,
    answers,
    notes: row.notes ?? '',
    verdicts: {
      helpful_verdict: row.helpful_verdict,
      honest_verdict: row.honest_verdict,
      harmless_verdict: row.harmless_verdict,
    },
  };
}

/** Every saved row, keyed by subject. */
export function toStoredScores(rows: HhhScoreRow[]): Map<string, StoredScore> {
  const map = new Map<string, StoredScore>();
  for (const row of rows) {
    const stored = toStoredScore(row);
    map.set(stored.key, stored);
  }
  return map;
}

/**
 * The terms this reviewer has scored, for the footer's "n of m". A set, so a
 * re-save — which updates the one row rather than adding another — never
 * inflates the count.
 */
export function scoredTermIds(rows: HhhScoreRow[]): Set<string> {
  const ids = new Set<string>();
  for (const row of rows) {
    if (row.subject_type === 'term' && row.term_id) ids.add(row.term_id);
  }
  return ids;
}
