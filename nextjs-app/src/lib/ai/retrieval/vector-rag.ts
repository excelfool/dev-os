import { notImplemented } from '@/lib/errors/app-error';
import type { RetrievalResult, RetrievalStrategy } from './types';

/**
 * `retrieval.vector` — stub. Chunked retrieval over `contract_chunks`
 * (`embedding vector(1536)`), the answer to C25/C27 (spec 08 v1.1 §D note).
 * The table exists and nothing writes it. Never selected while the capability
 * is not built: server-config rejects RETRIEVAL_STRATEGY=vector at boot.
 */
export class VectorRagStrategy implements RetrievalStrategy {
  readonly key = 'retrieval.vector' as const;

  assertAvailable(): void {
    throw notImplemented('retrieval.vector');
  }

  async buildContext(): Promise<RetrievalResult> {
    throw notImplemented('retrieval.vector');
  }
}
