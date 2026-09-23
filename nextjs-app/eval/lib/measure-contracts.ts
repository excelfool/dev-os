import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { extractPdfText } from '@/lib/pdf/extract-text';
import { estimateTokens } from '@/lib/pdf/page-utils';
import type { ContractMeasurement } from './blocked-contracts';

/** The instructor PDFs (git-ignored; see eval/datasets/msa-instructor/README.md). */
export const INSTRUCTOR_PDF_DIR = 'eval/datasets/msa-instructor/pdfs';

/**
 * Page and token counts with the app's own code — the same `extractPdfText`
 * and `estimateTokens` (o200k_base) the upload route gates on. Returns [] when
 * the PDFs are not present locally.
 */
export async function measureContracts(dir = INSTRUCTOR_PDF_DIR): Promise<ContractMeasurement[]> {
  if (!existsSync(dir)) return [];
  const out: ContractMeasurement[] = [];
  for (const file of readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.pdf')).sort()) {
    const extracted = await extractPdfText(readFileSync(join(dir, file)));
    out.push({ contract: file.replace(/\.pdf$/i, ''), pageCount: extracted.pageCount, tokens: estimateTokens(extracted.text) });
  }
  return out;
}
