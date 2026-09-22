/**
 * Spec 22 §2 — the 29 HHH codes, for the eval runners.
 *
 * The definition lives in `src/lib/eval/hhh-codes.ts` because Review mode
 * renders the same questions in the browser. Re-exported here so the runners
 * and the app cannot drift, and so §2's stated path still resolves.
 */
export {
  APPLICABLE_CODES,
  HHH_CODES,
  applicableCodes,
  codeFor,
  columnFor,
  isFailure,
  type HhhCode,
  type HhhPillar,
  type HhhPolarity,
  type HhhSubjectType,
} from '../../src/lib/eval/hhh-codes';
