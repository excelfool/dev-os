import type { AdapterResult } from '../types';

/**
 * DOCX ingestion (spec 21 §4, capability `ingest.docx`). Output carries
 * `[PAGE N]` markers so nothing downstream of upload changes.
 */
export interface DocxExtractor {
  extract(file: Buffer): Promise<AdapterResult<{ text: string; pageCount: number }>>;
}
