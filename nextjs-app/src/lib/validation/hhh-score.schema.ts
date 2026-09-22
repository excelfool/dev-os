import { z } from 'zod';
import { APPLICABLE_CODES, type HhhSubjectType } from '@/lib/eval/hhh-codes';

/**
 * Review-mode answer payload (spec 22 §4, route 32).
 *
 * The answers map is validated against `APPLICABLE_CODES[subject_type]`, not
 * against the 29 codes at large: asking a chat answer about page numbers is a
 * client bug, and silently storing it would put a value in a column the judge
 * never fills for that subject, quietly skewing the pillar rate.
 */

export const HHH_SUBJECT_TYPES = ['term', 'message', 'summary', 'risk_flag'] as const;

export const hhhScoreSchema = z
  .object({
    contract_id: z.string().uuid(),
    subject_type: z.enum(HHH_SUBJECT_TYPES),
    term_id: z.string().uuid().optional(),
    message_id: z.string().uuid().optional(),
    /** `true` = Yes, `false` = No, `null` = Skip (stored NULL, never a failure). */
    answers: z.record(z.string(), z.union([z.boolean(), z.null()])),
    notes: z.string().max(1000).optional(),
  })
  .strict();

export type HhhScoreInput = z.infer<typeof hhhScoreSchema>;

/**
 * The subject-id rule, mirroring the `hhh_scores_subject_check` CHECK:
 * exactly one id for a term or a message, and none at all for a summary.
 * `risk_flag` is rejected here until `risk.flag` is built — there is no id to
 * carry it yet.
 */
export function subjectIdError(input: HhhScoreInput): string | null {
  const { subject_type, term_id, message_id } = input;
  if (subject_type === 'term') {
    if (!term_id) return 'term_id is required for subject_type=term';
    if (message_id) return 'only term_id may be sent for subject_type=term';
    return null;
  }
  if (subject_type === 'message') {
    if (!message_id) return 'message_id is required for subject_type=message';
    if (term_id) return 'only message_id may be sent for subject_type=message';
    return null;
  }
  if (subject_type === 'summary') {
    if (term_id || message_id) return 'no subject id may be sent for subject_type=summary';
    return null;
  }
  return 'risk_flag scoring arrives with risk.flag';
}

/** Codes sent that this subject type is never asked (spec 22 §2). */
export function inapplicableCodes(subjectType: HhhSubjectType, answers: Record<string, unknown>): string[] {
  const allowed = new Set(APPLICABLE_CODES[subjectType]);
  return Object.keys(answers).filter((code) => !allowed.has(code));
}
