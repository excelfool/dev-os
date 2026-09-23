import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { callLlm } from '@/lib/ai/openai-client';
import { AppError } from '@/lib/errors/app-error';
import { buildQueryEnhancerUserMessage, QUERY_ENHANCER_SYSTEM_PROMPT } from '@/lib/ai/prompts/query-enhancer.v1';
import { getServerConfig } from '@/lib/utils/server-config';

/**
 * Query enhancer (spec 08 v1.1 §B, `retrieval.query_enhancer`). One small
 * call — `purpose='query_enhancer'`, OPENAI_MODEL_ENHANCER, temperature 0.2,
 * 120 tokens, JSON mode, 5 s, a single attempt never retried — that rewrites
 * the question into a retrieval query. It can add latency to a turn but can
 * never block one: any failure, timeout or unusable output is `null` and the
 * turn proceeds with the user's own words.
 *
 * Whether it runs at all is decided by the caller through the classifier
 * (`shouldEnhanceQuery`, C28).
 */
const ENHANCER_TEMPERATURE = 0.2;
/** A retrieval query longer than this is not one query; treat it as unusable. */
const MAX_QUERY_CHARS = 500;

export async function enhanceQuery(opts: {
  question: string;
  history: Array<{ role: 'user' | 'assistant'; content: string }>;
  userId: string;
  contractId: string;
  deadlineAt?: number;
  supabase: SupabaseClient;
}): Promise<string | null> {
  const cfg = getServerConfig();
  try {
    const result = await callLlm({
      purpose: 'query_enhancer',
      messages: [
        { role: 'system', content: QUERY_ENHANCER_SYSTEM_PROMPT },
        { role: 'user', content: buildQueryEnhancerUserMessage(opts.question, opts.history) },
      ],
      jsonMode: true,
      temperature: ENHANCER_TEMPERATURE,
      maxTokens: cfg.OPENAI_ENHANCER_MAX_TOKENS,
      timeoutMs: cfg.OPENAI_ENHANCER_TIMEOUT_MS,
      maxAttempts: 1,
      deadlineAt: opts.deadlineAt,
      userId: opts.userId,
      contractId: opts.contractId,
      supabase: opts.supabase,
    });
    return parseEnhancedQuery(result.content);
  } catch (err) {
    console.warn(JSON.stringify({ enhancer: 'skipped', code: err instanceof AppError ? err.code : 'INTERNAL' }));
    return null;
  }
}

/** `{ "query": "…" }` → the trimmed query, or null for anything else. */
export function parseEnhancedQuery(content: string): string | null {
  try {
    const parsed = JSON.parse(content) as { query?: unknown };
    if (typeof parsed?.query !== 'string') return null;
    const query = parsed.query.replace(/\s+/g, ' ').trim();
    return query.length > 0 && query.length <= MAX_QUERY_CHARS ? query : null;
  } catch {
    return null;
  }
}
