import { z } from 'zod';

/** Inline edit payload (spec 07 §5). */
export const keyTermUpdateSchema = z.object({
  value: z.string().min(1).max(2000),
});

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
