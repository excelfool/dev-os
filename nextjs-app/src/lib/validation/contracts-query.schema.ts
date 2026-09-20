import { z } from 'zod';

/**
 * Sort columns pass through this allow-list before reaching the query builder —
 * the client string is never interpolated (spec 13 §7).
 */
export const contractsQuerySchema = z.object({
  sort: z.enum(['created_at', 'file_name', 'contract_type']).default('created_at'),
  order: z.enum(['asc', 'desc']).default('desc'),
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(50).default(50),
  type: z.enum(['NDA', 'MSA']).optional(),
  status: z.enum(['uploaded', 'processing', 'completed', 'error']).optional(),
});

export type ContractsQuery = z.infer<typeof contractsQuerySchema>;
