import { notConfigured } from '../types';
import type { DocxExtractor } from './types';

/** Never throws, never logs contract content, always NOT_CONFIGURED (P-2). */
export class NullDocxExtractor implements DocxExtractor {
  extract() {
    return notConfigured<{ text: string; pageCount: number }>('ingest.docx');
  }
}
