import 'server-only';
import { getServerConfig } from '@/lib/utils/server-config';
import { getRagAdapter } from '@/lib/integrations/rag';
import { FullContextStrategy } from './full-context';
import { GraphRagStrategy } from './graph-rag';
import { N8nStrategy } from './n8n';
import { VectorRagStrategy } from './vector-rag';
import type { RetrievalStrategy } from './types';

export type { RetrievalInput, RetrievalResult, RetrievalStrategy } from './types';

/**
 * The strategy RETRIEVAL_STRATEGY names (default `full_context`), read from
 * the parsed server config — which has already refused `vector`/`graph` while
 * they are not built (spec 08 v1.1 §D).
 */
export function getRetrievalStrategy(): RetrievalStrategy {
  switch (getServerConfig().RETRIEVAL_STRATEGY) {
    case 'n8n':
      return new N8nStrategy(getRagAdapter());
    case 'vector':
      return new VectorRagStrategy();
    case 'graph':
      return new GraphRagStrategy();
    case 'full_context':
    default:
      return new FullContextStrategy();
  }
}
