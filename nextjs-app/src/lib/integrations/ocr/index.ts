import { NullOcrAdapter } from './null-adapter';
import type { OcrAdapter } from './types';

export type { OcrAdapter } from './types';

/**
 * Returns a vendor adapter when `OCR_PROVIDER` names one that exists; no
 * vendor adapter file exists today, so the NullAdapter is returned regardless
 * of configuration (spec 21 §4).
 */
export function getOcrAdapter(): OcrAdapter {
  return new NullOcrAdapter();
}
