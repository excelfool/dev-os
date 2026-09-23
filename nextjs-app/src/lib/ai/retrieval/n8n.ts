import 'server-only';
import { appError, notImplemented } from '@/lib/errors/app-error';
import { NullRagAdapter, type ExternalRagAdapter } from '@/lib/integrations/rag';
import type { RetrievalInput, RetrievalResult, RetrievalStrategy } from './types';

/**
 * `retrieval.n8n` — stub. Delegates the whole answer to the external RAG
 * adapter (spec 21 §4). With the NullAdapter (no URL/token) the route answers
 * 501 NOT_IMPLEMENTED with capability `retrieval.n8n`. A delegated answer is
 * validated and screened by the route exactly like a model answer.
 */
export class N8nStrategy implements RetrievalStrategy {
  readonly key = 'retrieval.n8n' as const;

  constructor(private readonly adapter: ExternalRagAdapter) {}

  assertAvailable(): void {
    if (this.adapter instanceof NullRagAdapter) throw notImplemented('retrieval.n8n');
  }

  async buildContext(input: RetrievalInput): Promise<RetrievalResult> {
    const result = await this.adapter.answer({
      contractId: input.contract.id,
      question: input.question,
      enhancedQuery: input.enhancedQuery,
      history: input.history,
      deadlineAt: input.deadlineAt,
    });
    if (result.ok) return { mode: 'delegated', answer: result.value.answer, cited_pages: result.value.cited_pages };
    if (result.reason === 'NOT_CONFIGURED') throw notImplemented('retrieval.n8n');
    throw appError(result.message === 'TIMEOUT' ? 'AI_TIMEOUT' : 'AI_UNAVAILABLE');
  }
}
