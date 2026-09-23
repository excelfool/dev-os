import 'server-only';
import { getServerConfig } from '@/lib/utils/server-config';
import { N8nRagAdapter } from './n8n-adapter';
import { NullRagAdapter } from './null-adapter';
import type { ExternalRagAdapter } from './types';

export type { ExternalRagAdapter, ExternalRagAnswer, ExternalRagInput } from './types';
export { NullRagAdapter } from './null-adapter';

/**
 * The n8n adapter only when BOTH `N8N_RAG_WEBHOOK_URL` and `N8N_RAG_TOKEN` are
 * set; the NullAdapter otherwise (spec 21 §4, P-2).
 */
export function getRagAdapter(): ExternalRagAdapter {
  const cfg = getServerConfig();
  if (cfg.N8N_RAG_WEBHOOK_URL && cfg.N8N_RAG_TOKEN) return new N8nRagAdapter(cfg.N8N_RAG_WEBHOOK_URL, cfg.N8N_RAG_TOKEN);
  return new NullRagAdapter();
}
