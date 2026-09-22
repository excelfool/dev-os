import type { AdapterResult } from '../types';

/** OCR (spec 21 §4, capability `ingest.ocr`). `confidence` is 0–100. */
export interface OcrAdapter {
  extract(pdf: Buffer): Promise<AdapterResult<{ text: string; pageCount: number; confidence: number }>>;
}
