import { notImplemented } from '@/lib/errors/app-error';
import type { RetrievalResult, RetrievalStrategy } from './types';

/** `retrieval.graph` — planned. Registry only; every method throws NOT_IMPLEMENTED. */
export class GraphRagStrategy implements RetrievalStrategy {
  readonly key = 'retrieval.graph' as const;

  assertAvailable(): void {
    throw notImplemented('retrieval.graph');
  }

  async buildContext(): Promise<RetrievalResult> {
    throw notImplemented('retrieval.graph');
  }
}
