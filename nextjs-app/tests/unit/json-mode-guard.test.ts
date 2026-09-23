import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * G48 (2026-09-23). OpenAI's JSON mode answers HTTP 400 with 0 tokens when no
 * message contains the word "json"; live, every query-enhancer call failed
 * this way. `callLlm` now refuses such a request before sending it, and every
 * JSON-mode prompt the app sends is checked against the guard here.
 */

const h = vi.hoisted(() => ({
  create: vi.fn(),
  recordOpenAiCall: vi.fn(async () => undefined),
  errors: null as typeof import('openai') | null,
}));

vi.mock('openai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('openai')>();
  h.errors = actual;
  class MockOpenAI {
    static APIError = actual.APIError;
    static APIConnectionError = actual.APIConnectionError;
    static APIConnectionTimeoutError = actual.APIConnectionTimeoutError;
    static APIUserAbortError = actual.APIUserAbortError;
    chat = { completions: { create: h.create } };
  }
  return { ...actual, default: MockOpenAI };
});
vi.mock('@/lib/utils/server-config', () => ({
  getServerConfig: () => ({
    OPENAI_API_KEY: 'test-key',
    OPENAI_BASE_URL: '',
    OPENAI_MODEL: 'gpt-4o',
    OPENAI_MODEL_EXTRACTION: '',
    OPENAI_MODEL_ENHANCER: '',
    OPENAI_TIMEOUT_MS: 20_000,
    OPENAI_MAX_RETRIES: 1,
  }),
}));
vi.mock('@/lib/metrics/cost', () => ({ recordOpenAiCall: h.recordOpenAiCall }));

import { assertJsonModeMessages, callLlm, type LlmMessage } from '@/lib/ai/openai-client';
import { buildExtractionSystemPrompt, buildExtractionUserMessage } from '@/lib/ai/prompts/extraction.v2';
import { JSON_REPAIR_PROMPT } from '@/lib/ai/prompts/repair.v1';
import { buildQueryEnhancerUserMessage, QUERY_ENHANCER_SYSTEM_PROMPT } from '@/lib/ai/prompts/query-enhancer.v1';
import { MSA_TERMS } from '@/lib/ai/term-library';

const CONTRACT = '[PAGE 1]\nThis Agreement is governed by the laws of the State of Delaware.';

beforeEach(() => {
  h.create.mockReset();
  h.recordOpenAiCall.mockClear();
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('assertJsonModeMessages', () => {
  it('passes when any message contains "json", in any case', () => {
    expect(() => assertJsonModeMessages([{ role: 'system', content: 'Return JSON.' }])).not.toThrow();
    expect(() => assertJsonModeMessages([{ role: 'user', content: 'x' }, { role: 'system', content: 'a json object' }])).not.toThrow();
  });

  it('throws a clear error when no message does', () => {
    expect(() => assertJsonModeMessages([{ role: 'system', content: 'Return { "query": "…" }.' }])).toThrow(
      /JSON mode requires the word "json"/,
    );
  });

  it('the pre-G48 enhancer prompt is exactly what it rejects', () => {
    const before = QUERY_ENHANCER_SYSTEM_PROMPT.replace('Return JSON: { "query": "…" }.', 'Return `{ "query": "…" }`.');
    expect(before).not.toBe(QUERY_ENHANCER_SYSTEM_PROMPT);
    expect(() =>
      assertJsonModeMessages([
        { role: 'system', content: before },
        { role: 'user', content: buildQueryEnhancerUserMessage('does it renew by itself?', []) },
      ]),
    ).toThrow();
  });
});

describe('callLlm refuses before the request', () => {
  it('makes no API call and writes no openai_calls row for a JSON-mode request without "json"', async () => {
    await expect(
      callLlm({
        purpose: 'query_enhancer',
        messages: [{ role: 'system', content: 'Return { "query": "…" }.' }],
        jsonMode: true,
        temperature: 0.2,
        maxTokens: 120,
        userId: 'u1',
        supabase: {} as never,
      }),
    ).rejects.toThrow(/JSON mode requires the word "json"/);
    expect(h.create).not.toHaveBeenCalled();
    expect(h.recordOpenAiCall).not.toHaveBeenCalled();
  });

  it('a non-JSON-mode request is not checked', async () => {
    h.create.mockResolvedValueOnce({ choices: [{ message: { content: 'ok' } }], usage: { prompt_tokens: 1, completion_tokens: 1 } });
    await expect(
      callLlm({ purpose: 'chat', messages: [{ role: 'user', content: 'hi' }], temperature: 0.4, maxTokens: 10, userId: 'u1', supabase: {} as never }),
    ).resolves.toMatchObject({ content: 'ok' });
  });

  it('logs the API error message for a 4xx, never the request content', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const E = h.errors!;
    h.create.mockRejectedValueOnce(
      new E.APIError(400, { message: "'messages' must contain the word 'json' in some form, to use 'response_format' of type 'json_object'." }, 'bad request', new Headers()),
    );
    await expect(
      callLlm({
        purpose: 'query_enhancer',
        messages: [{ role: 'system', content: 'Return JSON. SECRET CONTRACT TEXT' }],
        jsonMode: true,
        temperature: 0.2,
        maxTokens: 120,
        userId: 'u1',
        supabase: {} as never,
      }),
    ).rejects.toThrow();
    const line = warn.mock.calls.map((c) => JSON.parse(String(c[0]))).find((o) => o.llm === 'attempt_failed');
    expect(line).toMatchObject({ purpose: 'query_enhancer', status: 400, message: expect.stringContaining("must contain the word 'json'") });
    expect(JSON.stringify(line)).not.toContain('SECRET CONTRACT TEXT');
  });
});

describe('every JSON-mode prompt the app sends passes the guard', () => {
  it('extraction (v2), every batch shape', () => {
    const user = { role: 'user' as const, content: buildExtractionUserMessage(CONTRACT) };
    for (const messages of [
      [{ role: 'system' as const, content: buildExtractionSystemPrompt('NDA', []) }, user],
      [{ role: 'system' as const, content: buildExtractionSystemPrompt('MSA', ['Data retention period'], { standardTermNames: MSA_TERMS.slice(0, 18).map((t) => t.term_name) }) }, user],
    ] satisfies LlmMessage[][]) {
      expect(() => assertJsonModeMessages(messages)).not.toThrow();
    }
  });

  it('extraction JSON repair (the repair prompt itself says JSON)', () => {
    expect(() => assertJsonModeMessages([{ role: 'user', content: JSON_REPAIR_PROMPT }])).not.toThrow();
  });

  it('query enhancer (G48 fix)', () => {
    expect(() =>
      assertJsonModeMessages([
        { role: 'system', content: QUERY_ENHANCER_SYSTEM_PROMPT },
        { role: 'user', content: buildQueryEnhancerUserMessage('and after it expires?', []) },
      ]),
    ).not.toThrow();
  });
});
