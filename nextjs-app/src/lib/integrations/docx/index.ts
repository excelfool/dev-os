import { NullDocxExtractor } from './null-adapter';
import type { DocxExtractor } from './types';

export type { DocxExtractor } from './types';

/**
 * Returns the library extractor once one exists and `DOCX_INGEST_ENABLED=true`;
 * today no extractor file exists, so the NullAdapter is returned regardless
 * (spec 21 §4: "wiring one is one file plus config").
 */
export function getDocxExtractor(): DocxExtractor {
  return new NullDocxExtractor();
}
