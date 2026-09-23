import type { QueryClass } from '@/types/domain';
import type { HistoryMessage } from '@/lib/services/chat-service';

/**
 * Spec 08 v1.1 §D — how a chat turn gets its grounding. Contract text stays the
 * single source of truth for every strategy (PRD §7).
 */
export interface RetrievalInput {
  contract: { id: string; contract_text: string; page_count: number };
  question: string;
  enhancedQuery: string | null;
  queryClass: QueryClass;
  history: HistoryMessage[];
  /** The chat turn's deadline (G43); a delegated backend shares it. */
  deadlineAt: number;
}

export type RetrievalResult =
  | { mode: 'context'; blocks: string[] }
  | { mode: 'delegated'; answer: string; cited_pages: number[] };

export interface RetrievalStrategy {
  readonly key: 'retrieval.full_context' | 'retrieval.vector' | 'retrieval.graph' | 'retrieval.n8n';
  /** Returns the context blocks to place before the history, or delegates the whole answer. */
  buildContext(input: RetrievalInput): Promise<RetrievalResult>;
  /**
   * Throws 501 NOT_IMPLEMENTED before any work when the strategy cannot run
   * (an unconfigured n8n backend). Called by the route after its 401/404 checks.
   */
  assertAvailable(): void;
}
