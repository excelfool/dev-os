import { z } from 'zod';

/**
 * File checks (size, magic bytes, pages, tokens) are performed imperatively in
 * the upload route — `File` cannot be fully expressed in zod (spec 01 §7).
 */
export const uploadSchema = z.object({
  contract_type: z.enum(['NDA', 'MSA']),
});

export type UploadInput = z.infer<typeof uploadSchema>;
