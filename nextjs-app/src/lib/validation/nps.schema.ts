import { z } from 'zod';

export const npsSchema = z.object({
  score: z.number().int().min(0).max(10),
  comment: z.string().max(1000).optional(),
});

export type NpsInput = z.infer<typeof npsSchema>;
