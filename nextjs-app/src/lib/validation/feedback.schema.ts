import { z } from 'zod';

export const feedbackSchema = z.object({
  contract_id: z.string().uuid(),
  rating: z.enum(['up', 'down']),
  comment: z.string().max(1000).optional(),
  survey_accuracy: z.enum(['yes', 'partially', 'no']).optional(),
});

export type FeedbackInput = z.infer<typeof feedbackSchema>;
