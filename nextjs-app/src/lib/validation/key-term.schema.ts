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
  source_sentence: z.string().nullable(),
  /** v1.1 (spec 06 v1.1 §A). Absent from a v1 response ⇒ null. */
  reasoning: z.string().nullable().optional(),
});

export type ModelKeyTerm = z.infer<typeof keyTermSchema>;

export const extractionResponseSchema = z.object({
  detected_type: z.enum(['NDA', 'MSA', 'OTHER']),
  terms: z.array(z.unknown()),
});
