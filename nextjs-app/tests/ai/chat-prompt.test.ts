import { describe, expect, it } from 'vitest';
import { assembleChatMessages, type HistoryMessage } from '@/lib/services/chat-service';

/**
 * Spec 08 §8 and v1.1 §E — the prompt the model is actually sent, pinned as
 * snapshots: with and without the enhancer line, and `history` never with the
 * document or the enhancer.
 */

const CONTRACT = '[PAGE 1]\nThis Agreement renews for successive 12-month terms.\n\n[PAGE 2]\nEither party may give 60 days notice.';
const HISTORY: HistoryMessage[] = [
  { role: 'user', content: 'Is there an auto-renewal clause?' },
  { role: 'assistant', content: 'Based on the document, it renews for 12-month terms. [Page 1]' },
];

const assemble = (queryClass: 'contract' | 'history' | 'both', userMessage: string, enhancedQuery: string | null) =>
  assembleChatMessages({ queryClass, contractText: CONTRACT, history: HISTORY, userMessage, maxHistoryTokens: 8_000, enhancedQuery });

describe('chat prompt snapshots', () => {
  it('contract, with the enhancer line', () => {
    expect(assemble('contract', 'how much notice to stop it renewing?', 'auto-renewal: non-renewal notice period')).toMatchSnapshot();
  });

  it('contract, without the enhancer line', () => {
    expect(assemble('contract', 'how much notice to stop it renewing?', null)).toMatchSnapshot();
  });

  it('both (R10 fallback), with the enhancer line', () => {
    expect(assemble('both', 'and for the supplier?', 'supplier non-renewal notice period')).toMatchSnapshot();
  });

  it('history', () => {
    expect(assemble('history', 'repeat that', null)).toMatchSnapshot();
  });
});

describe('history never carries the document or the enhancer', () => {
  it.each([null, 'a rewrite that must be ignored'])('with enhancedQuery = %j', (enhancedQuery) => {
    const joined = assemble('history', 'repeat that', enhancedQuery).map((m) => m.content).join('\n');
    expect(joined).not.toContain('[PAGE 1]');
    expect(joined).not.toContain('Search focus:');
  });

  it('history is passed ascending, before the new question', () => {
    const messages = assemble('contract', 'q', null);
    expect(messages.slice(-3).map((m) => m.content)).toEqual([HISTORY[0]!.content, HISTORY[1]!.content, 'q']);
  });
});
