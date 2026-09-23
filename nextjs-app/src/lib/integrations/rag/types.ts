import type { AdapterResult } from '../types';

/** The spec 08 v1.1 §D payload an external RAG backend receives. */
export interface ExternalRagInput {
  contractId: string;
  question: string;
  /** The query enhancer's rewrite, or null (spec 08 v1.1 §B/§D). */
  enhancedQuery: string | null;
  history: Array<{ role: 'user' | 'assistant'; content: string }>;
  /** Epoch ms: the chat turn's deadline (G43). The call never outlives it. */
  deadlineAt: number;
}

export interface ExternalRagAnswer {
  answer: string;
  cited_pages: number[];
}

/**
 * External RAG backend (spec 21 §4 `rag/`, capability `retrieval.n8n`). The
 * answer it returns is not trusted: the chat route runs the shared citation
 * validation and the outbound guardrail screen on it before it is stored.
 */
export interface ExternalRagAdapter {
  answer(input: ExternalRagInput): Promise<AdapterResult<ExternalRagAnswer>>;
}
