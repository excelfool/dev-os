import { fullContextBlocks } from '@/lib/services/chat-service';
import type { RetrievalInput, RetrievalResult, RetrievalStrategy } from './types';

/**
 * `retrieval.full_context` — built. The whole `contract_text` for
 * `contract`/`both` (plus the enhancer's Search focus line), nothing for
 * `history`: exactly spec 08 §5, unchanged.
 */
export class FullContextStrategy implements RetrievalStrategy {
  readonly key = 'retrieval.full_context' as const;

  assertAvailable(): void {}

  async buildContext(input: RetrievalInput): Promise<RetrievalResult> {
    return { mode: 'context', blocks: fullContextBlocks(input.queryClass, input.contract.contract_text, input.enhancedQuery) };
  }
}
