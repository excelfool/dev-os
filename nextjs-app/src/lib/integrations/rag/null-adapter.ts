import { notConfigured } from '../types';
import type { ExternalRagAdapter, ExternalRagAnswer } from './types';

/** Never throws, never logs contract content, always NOT_CONFIGURED (P-2). */
export class NullRagAdapter implements ExternalRagAdapter {
  answer() {
    return notConfigured<ExternalRagAnswer>('retrieval.n8n');
  }
}
