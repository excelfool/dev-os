import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LlmCallOptions, LlmResult } from '@/lib/ai/openai-client';

/**
 * Spec 08 v1.1 §B and §E — the query enhancer, gated by C28: it runs only when
 * the message carries no history signal; a failure or timeout is null and the
 * turn proceeds; the `Search focus:` block exists only when a rewrite does.
 */

const callLlm = vi.fn<(opts: LlmCallOptions) => Promise<LlmResult>>();
vi.mock('@/lib/ai/openai-client', () => ({ callLlm: (opts: LlmCallOptions) => callLlm(opts) }));
vi.mock('@/lib/utils/server-config', () => ({
  getServerConfig: () => ({ OPENAI_ENHANCER_TIMEOUT_MS: 5_000, OPENAI_ENHANCER_MAX_TOKENS: 120 }),
}));

import { enhanceQuery, parseEnhancedQuery } from '@/lib/ai/query-enhancer';
import { QUERY_ENHANCER_SYSTEM_PROMPT } from '@/lib/ai/prompts/query-enhancer.v1';
import { analyseQuery, shouldEnhanceQuery } from '@/lib/ai/query-classifier';
import { assembleChatMessages } from '@/lib/services/chat-service';
import { appError } from '@/lib/errors/app-error';

const ok = (content: string): LlmResult => ({ content, promptTokens: 80, completionTokens: 20, latencyMs: 400, attempts: 1 });
const baseOpts = { history: [], userId: 'u1', contractId: 'c1', supabase: {} as never };

beforeEach(() => {
  callLlm.mockReset();
});

describe('the C28 gate: the enhancer runs only without a history signal', () => {
  it.each([
    ['a contract question, empty session', 'Is there an auto-renewal clause?', false],
    ['a contract question, existing conversation', 'What is the liability cap?', true],
    // R10: no contract signal, a conversation exists ⇒ `both`, but nothing refers to the conversation.
    ['a vague follow-up reached through the R10 fallback', 'And for the supplier?', true],
  ])('runs for %s', (_label, message, hasHistory) => {
    expect(shouldEnhanceQuery(analyseQuery(message, hasHistory))).toBe(true);
  });

  it.each([
    ['a pure history question', 'repeat that', true],
    ['a first-person recall', 'What have I asked you so far', true],
    ['history plus contract (a real history signal)', 'what did you say earlier about indemnity?', true],
    ['history plus contract on an empty session', 'what did you say earlier about the notice clause?', false],
  ])('never runs for %s', (_label, message, hasHistory) => {
    const analysis = analyseQuery(message, hasHistory);
    expect(analysis.historySignal).toBe(true);
    expect(shouldEnhanceQuery(analysis)).toBe(false);
  });

  it('the R10 case really is class both with no history signal', () => {
    expect(analyseQuery('And for the supplier?', true)).toEqual({
      queryClass: 'both',
      historySignal: false,
      contractSignal: false,
    });
  });
});

describe('enhanceQuery', () => {
  it('makes one JSON-mode call on the §B settings and returns the rewrite', async () => {
    callLlm.mockResolvedValue(ok('{ "query": "auto-renewal clause: renewal term and non-renewal notice period" }'));

    const enhanced = await enhanceQuery({ ...baseOpts, question: 'does it renew by itself?', deadlineAt: 123 });

    expect(enhanced).toBe('auto-renewal clause: renewal term and non-renewal notice period');
    expect(callLlm).toHaveBeenCalledTimes(1);
    const opts = callLlm.mock.calls[0]![0];
    expect(opts).toMatchObject({
      purpose: 'query_enhancer',
      jsonMode: true,
      temperature: 0.2,
      maxTokens: 120,
      timeoutMs: 5_000,
      maxAttempts: 1,
      deadlineAt: 123,
    });
    expect(opts.messages[0]).toEqual({ role: 'system', content: QUERY_ENHANCER_SYSTEM_PROMPT });
    expect(opts.messages[1]!.content).toContain('Question to rewrite: does it renew by itself?');
  });

  it('a timeout yields null, never a thrown error, so the turn proceeds', async () => {
    callLlm.mockRejectedValue(appError('AI_TIMEOUT'));
    await expect(enhanceQuery({ ...baseOpts, question: 'is there a cap?' })).resolves.toBeNull();
    expect(callLlm).toHaveBeenCalledTimes(1);
  });

  it('a provider failure yields null', async () => {
    callLlm.mockRejectedValue(appError('AI_UNAVAILABLE'));
    await expect(enhanceQuery({ ...baseOpts, question: 'is there a cap?' })).resolves.toBeNull();
  });

  it('passes recent conversation so pronouns can be expanded', async () => {
    callLlm.mockResolvedValue(ok('{"query":"x"}'));
    await enhanceQuery({
      ...baseOpts,
      question: 'and what about its notice period?',
      history: [
        { role: 'user', content: 'Is there a termination for convenience clause?' },
        { role: 'assistant', content: 'Based on the document, yes. [Page 2]' },
      ],
    });
    const user = callLlm.mock.calls[0]![0].messages[1]!.content;
    expect(user).toContain('User: Is there a termination for convenience clause?');
    expect(user.indexOf('Conversation so far')).toBeLessThan(user.indexOf('Question to rewrite'));
  });
});

describe('parseEnhancedQuery', () => {
  it.each([
    ['not JSON', 'auto-renewal clause'],
    ['no query key', '{"q":"x"}'],
    ['a null query', '{"query": null}'],
    ['an empty query', '{"query": "   "}'],
    ['a non-string query', '{"query": 7}'],
    ['an over-long query', JSON.stringify({ query: 'x'.repeat(501) })],
  ])('rejects %s', (_label, content) => {
    expect(parseEnhancedQuery(content)).toBeNull();
  });

  it('collapses whitespace', () => {
    expect(parseEnhancedQuery(JSON.stringify({ query: '  limitation of\n liability  cap ' }))).toBe('limitation of liability cap');
  });
});

describe('Search focus in the assembled prompt', () => {
  const base = {
    contractText: '[PAGE 1]\nThe term renews automatically.',
    history: [],
    userMessage: 'does it renew by itself?',
    maxHistoryTokens: 8_000,
  };

  it('is present only with a rewrite, directly after the document block, with the question last', () => {
    const messages = assembleChatMessages({ ...base, queryClass: 'contract', enhancedQuery: 'auto-renewal clause' });
    const documentIndex = messages.findIndex((m) => m.content.includes('[PAGE 1]'));
    expect(messages[documentIndex + 1]).toEqual({ role: 'system', content: 'Search focus: auto-renewal clause' });
    expect(messages.at(-1)).toEqual({ role: 'user', content: 'does it renew by itself?' });
  });

  it.each([null, undefined])('is absent when the rewrite is %s', (enhancedQuery) => {
    const messages = assembleChatMessages({ ...base, queryClass: 'contract', enhancedQuery });
    expect(messages.some((m) => m.content.startsWith('Search focus:'))).toBe(false);
  });

  it('is never added to a history prompt, even if a rewrite is passed', () => {
    const messages = assembleChatMessages({ ...base, queryClass: 'history', enhancedQuery: 'anything' });
    expect(messages.some((m) => m.content.startsWith('Search focus:'))).toBe(false);
  });
});
