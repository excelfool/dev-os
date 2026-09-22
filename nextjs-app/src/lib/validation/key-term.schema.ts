import { z } from 'zod';

/**
 * Inline edit payload (spec 07 v1.1 §D). Any NON-EMPTY subset of the three
 * editable fields; each field that is present is validated on its own and
 * reports its own error code, because the three are edited from three separate
 * controls and a shared "something is wrong" message would not tell the user
 * which one to fix.
 *
 * `page_number`'s upper bound is the contract's `page_count`, which is not
 * known here — the route applies it after loading the contract.
 */
export const KEY_TERM_EDITABLE_FIELDS = ['value', 'page_number', 'reasoning'] as const;
export type KeyTermEditableField = (typeof KEY_TERM_EDITABLE_FIELDS)[number];

/** The error code each field reports, so the editor can render per-field copy. */
export const KEY_TERM_FIELD_ERROR_CODE = {
  value: 'INVALID_VALUE',
  page_number: 'INVALID_PAGE',
  reasoning: 'INVALID_REASONING',
} as const;

export const keyTermUpdateSchema = z
  .object({
    value: z.string().min(1).max(2000).optional(),
    page_number: z.number().int().min(1).optional(),
    reasoning: z.string().min(1).max(500).optional(),
  })
  // An unknown key is a client bug, not an edit: accepting it silently would
  // let a typo look like a successful save.
  .strict();

export type KeyTermUpdateInput = z.infer<typeof keyTermUpdateSchema>;

/**
 * One item of the model's extraction output (spec 06 §4 step 1). A failing item
 * is dropped and counted — never persisted as a broken row.
 */
export const keyTermSchema = z.object({
  term_name: z.string().min(1),
  value: z.string().nullable(),
  page_number: z.number().int().nullable(),
  confidence_score: z.number().min(0).max(1),
  /** v1 name. v2 returns `source_anchor` instead; the service accepts either. */
  source_sentence: z.string().nullable().optional(),
  /** v2 (D47 c): the shortest verbatim span (≤ 25 words) holding the answer. */
  source_anchor: z.string().nullable().optional(),
  /** v1.1 (spec 06 v1.1 §A). Absent from a v1 response ⇒ null. */
  reasoning: z.string().nullable().optional(),
});

export type ModelKeyTerm = z.infer<typeof keyTermSchema>;

export const extractionResponseSchema = z.object({
  detected_type: z.enum(['NDA', 'MSA', 'OTHER']),
  terms: z.array(z.unknown()),
});
