import { z } from 'zod';

export const customTermSchema = z.object({
  term_names: z.array(z.string().trim().min(3).max(60)).min(1).max(5),
});

export type CustomTermInput = z.infer<typeof customTermSchema>;
