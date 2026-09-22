import { notConfigured } from '../types';
import type { OcrAdapter } from './types';

/** Never throws, never logs contract content, always NOT_CONFIGURED (P-2). */
export class NullOcrAdapter implements OcrAdapter {
  extract() {
    return notConfigured<{ text: string; pageCount: number; confidence: number }>('ingest.ocr');
  }
}
