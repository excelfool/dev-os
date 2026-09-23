import 'server-only';
import { z } from 'zod';
import type { AdapterResult } from '../types';
import type { ExternalRagAdapter, ExternalRagAnswer, ExternalRagInput } from './types';

/**
 * n8n webhook RAG backend (spec 08 v1.1 §D, spec 21 §4). POSTs
 * `{ contract_id, question, enhanced_query, history }` with
 * `Authorization: Bearer N8N_RAG_TOKEN`, and waits no longer than the chat
 * turn's own budget (G43: one 15 s budget for the whole turn, shared).
 */
const responseSchema = z.object({
  answer: z.string().min(1),
  cited_pages: z.array(z.number().int()).default([]),
});

/** Below this the call is not worth starting; the turn reports a timeout instead. */
const MIN_CALL_MS = 1_000;

export class N8nRagAdapter implements ExternalRagAdapter {
  constructor(
    private readonly webhookUrl: string,
    private readonly token: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async answer(input: ExternalRagInput): Promise<AdapterResult<ExternalRagAnswer>> {
    const remaining = input.deadlineAt - Date.now();
    if (remaining < MIN_CALL_MS) {
      return { ok: false, reason: 'VENDOR_ERROR', capability: 'retrieval.n8n', message: 'TIMEOUT', retryable: true };
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), remaining);
    try {
      const res = await this.fetchImpl(this.webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.token}` },
        body: JSON.stringify({
          contract_id: input.contractId,
          question: input.question,
          enhanced_query: input.enhancedQuery,
          history: input.history,
        }),
        signal: controller.signal,
      });
      if (!res.ok) {
        return { ok: false, reason: 'VENDOR_ERROR', capability: 'retrieval.n8n', message: `HTTP ${res.status}`, retryable: res.status >= 500 };
      }
      const parsed = responseSchema.safeParse(await res.json());
      if (!parsed.success) {
        return { ok: false, reason: 'VENDOR_ERROR', capability: 'retrieval.n8n', message: 'INVALID_RESPONSE', retryable: false };
      }
      return { ok: true, value: parsed.data };
    } catch (err) {
      const timedOut = err instanceof Error && err.name === 'AbortError';
      return { ok: false, reason: 'VENDOR_ERROR', capability: 'retrieval.n8n', message: timedOut ? 'TIMEOUT' : 'NETWORK', retryable: true };
    } finally {
      clearTimeout(timer);
    }
  }
}
