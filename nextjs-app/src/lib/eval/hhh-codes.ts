import questionnaire from './hhh-questionnaire.json';

/**
 * The 29 HHH codes (spec 22 §2, PRD §10).
 *
 * The single source is `docs/reference/hhh-questionnaire-instructor.csv`.
 * `npm run eval:sync-refs` copies it to `eval/datasets/hhh-questionnaire.csv`
 * and parses it into the JSON imported above, because these questions are
 * rendered in the BROWSER by Review mode and a bundle cannot read a CSV off
 * disk. A unit test asserts the copy is byte-identical and that the questions
 * here are verbatim, so the form, the judge prompt and the sheet export can
 * never ask different questions.
 *
 * No `server-only` import: the app (client and server) and the eval runners
 * all read this module.
 */

export type HhhPillar = 'helpful' | 'honest' | 'harmless';
export type HhhPolarity = 'yes_is_failure' | 'no_is_failure';
export type HhhSubjectType = 'term' | 'message' | 'summary' | 'risk_flag';

export interface HhhCode {
  pillar: HhhPillar;
  code: string;
  /** Verbatim from the instructor CSV — never paraphrased on screen. */
  question: string;
  polarity: HhhPolarity;
  /** The `hhh_scores` column this answer is stored in. */
  column: string;
}

export const HHH_CODES: readonly HhhCode[] = questionnaire as HhhCode[];

const BY_CODE = new Map(HHH_CODES.map((c) => [c.code, c]));

export function codeFor(code: string): HhhCode | undefined {
  return BY_CODE.get(code);
}

/** The `hhh_scores` column a code writes to, or undefined for an unknown code. */
export function columnFor(code: string): string | undefined {
  return BY_CODE.get(code)?.column;
}

/**
 * Whether one answer counts as a failure (spec 22 §2, PRD §10):
 * a `yes_is_failure` code fails on Yes, a `no_is_failure` code fails on No,
 * and a skipped answer never fails. Any failure marks the pillar unsuccessful.
 *
 * The database computes the stored verdicts with the same table
 * (`compute_hhh_verdicts`); this is the client-side mirror, used for tests and
 * for anything that needs the rule without a round trip.
 */
export function isFailure(code: string, answer: boolean | null | undefined): boolean {
  if (answer === null || answer === undefined) return false;
  const definition = BY_CODE.get(code);
  if (!definition) return false;
  return definition.polarity === 'yes_is_failure' ? answer === true : answer === false;
}

const ALL = HHH_CODES.map((c) => c.code);

/**
 * Which codes each subject type is asked (spec 22 §2). A term and a risk flag
 * take all 29; a chat answer and a summary take the listed subsets, because
 * the codes about page numbers, reasoning and clause coverage have no meaning
 * for them.
 *
 * Subsets stay in file order, so every form reads in the same sequence.
 */
export const APPLICABLE_CODES: Record<HhhSubjectType, readonly string[]> = {
  term: ALL,
  risk_flag: ALL,
  message: ['H1', 'H2', 'H3', 'O1', 'O2', 'O3', 'O9', 'A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A8', 'A9'],
  summary: ['H1', 'H2', 'H3', 'H5', 'O1', 'O2', 'O3', 'O5', 'O9', 'A1', 'A4', 'A5', 'A7', 'A8', 'A9'],
};

/**
 * The codes to ask for one subject (spec 22 §2).
 *
 * O8 ("… the correct contract of a stitched document") is only meaningful when
 * the contract really is several documents stitched together, so it is asked
 * only then and stored NULL otherwise — asking it of an ordinary contract
 * would invite a misleading "No".
 */
export function applicableCodes(
  subjectType: HhhSubjectType,
  context: { stitched?: boolean } = {},
): readonly string[] {
  const codes = APPLICABLE_CODES[subjectType];
  if (context.stitched) return codes;
  return codes.filter((code) => code !== 'O8');
}
