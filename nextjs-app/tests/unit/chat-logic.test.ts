import { describe, expect, it } from 'vitest';
import { classifyQuery } from '@/lib/ai/query-classifier';
import { validateCitations, isCannotFindAnswer, truncateHistory } from '@/lib/services/chat-service';
import { buildChatSystemPrompt, CANNOT_FIND_ANSWER } from '@/lib/ai/prompts/chat.v1';

describe('classifyQuery', () => {
  it('classifies a contract question as contract', () => {
    expect(classifyQuery('Is there an auto-renewal clause?', true)).toBe('contract');
    expect(classifyQuery('What is the liability cap?', false)).toBe('contract');
  });

  it('classifies a history+contract question as both', () => {
    expect(classifyQuery('what did you say earlier about indemnity?', true)).toBe('both');
  });

  it('classifies a bare back-reference as history when history exists', () => {
    expect(classifyQuery('repeat that', true)).toBe('history');
    expect(classifyQuery('what did you say?', true)).toBe('history');
  });

  it('never yields history when there is no history', () => {
    expect(classifyQuery('repeat that', false)).toBe('contract');
    expect(classifyQuery('you said earlier', false)).toBe('contract');
  });

  it('defaults to contract — the safe class that includes the document', () => {
    expect(classifyQuery('hello', false)).toBe('contract');
  });
});

describe('validateCitations', () => {
  it('dedupes and sorts cited pages', () => {
    const r = validateCitations('Based on the document… [Page 4] and [Page 2] and [Page 4]', 10);
    expect(r.citedPages).toEqual([2, 4]);
    expect(r.citationVerified).toBe(true);
    expect(r.needsRepair).toBe(false);
  });

  it('discards a page outside the document and treats it as no citation', () => {
    const r = validateCitations('Based on the document, see [Page 99]', 10);
    expect(r.citedPages).toEqual([]);
    expect(r.citationVerified).toBe(false);
    expect(r.needsRepair).toBe(true);
  });

  it('accepts the exact fallback with no citation', () => {
    const r = validateCitations('I cannot find this in the document.', 10);
    expect(r.citationVerified).toBe(true);
    expect(r.needsRepair).toBe(false);
    expect(r.citedPages).toEqual([]);
  });

  it('flags a claim with no citation for repair', () => {
    const r = validateCitations('The agreement auto-renews every year.', 10);
    expect(r.needsRepair).toBe(true);
    expect(r.citationVerified).toBe(false);
  });

  it('is case-insensitive on the tag', () => {
    expect(validateCitations('see [page 3]', 5).citedPages).toEqual([3]);
  });
});

describe('isCannotFindAnswer', () => {
  it('matches the fallback regardless of surrounding whitespace', () => {
    expect(isCannotFindAnswer('  I cannot find this in the document.  ')).toBe(true);
  });

  it('does not match an answer that merely contains it', () => {
    expect(isCannotFindAnswer('I cannot find this in the document. But [Page 2] says…')).toBe(false);
  });
});

describe('truncateHistory', () => {
  it('keeps everything under budget', () => {
    const history = [
      { role: 'user' as const, content: 'short' },
      { role: 'assistant' as const, content: 'also short' },
    ];
    expect(truncateHistory(history, 8000)).toHaveLength(2);
  });

  it('drops oldest-first when over budget', () => {
    const history = Array.from({ length: 50 }, (_, i) => ({
      role: (i % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
      content: 'a fairly long message '.repeat(20),
    }));
    const kept = truncateHistory(history, 500);
    expect(kept.length).toBeLessThan(history.length);
    // The most recent turn always survives.
    expect(kept.at(-1)).toEqual(history.at(-1));
  });
});

describe('classifyQuery — indemnity stem regression (spec 08 §4 vs §8)', () => {
  it('treats every indemnity word form as a contract signal', () => {
    for (const word of ['indemnity', 'indemnify', 'indemnification']) {
      expect(classifyQuery(`what did you say earlier about ${word}?`, true)).toBe('both');
      expect(classifyQuery(`what is the ${word} scope?`, false)).toBe('contract');
    }
  });
});

describe('classifyQuery — prefix stems must match longer words (spec 08 §4 bug)', () => {
  it('matches every termination word form', () => {
    for (const word of ['terminate', 'termination', 'terminated']) {
      expect(classifyQuery(`what did you say earlier about ${word}?`, true)).toBe('both');
    }
  });

  it('matches every renewal word form', () => {
    for (const word of ['renew', 'renewal', 'renews']) {
      expect(classifyQuery(`is there an auto-${word} clause?`, false)).toBe('contract');
    }
  });
});

/**
 * Lab 2 Lesson 2 — the live four-turn memory test failed on both
 * classification turns, each returning the CONTRACT-path refusal.
 * Two distinct root causes, one symptom.
 */
describe('classifyQuery — conversational questions in the user\'s own voice', () => {
  it('classifies "What have I asked you so far" as history', () => {
    // RC2: HISTORY_SIGNAL only covered second-person ("what did you"), so a
    // first-person question about the conversation fell through to `contract`,
    // the document was searched for it and the model refused.
    expect(classifyQuery('What have I asked you so far', true)).toBe('history');
  });

  it('classifies first-person and collective recall as history', () => {
    for (const q of [
      'what did I ask you first',
      'what have we discussed',
      'summarise my questions',
      'what have I asked so far',
    ]) {
      expect(classifyQuery(q, true)).toBe('history');
    }
  });

  it('keeps a demonstrative follow-up as history', () => {
    expect(classifyQuery('What does that mean in practice?', true)).toBe('history');
  });

  it('falls back to both, not contract, once a conversation exists', () => {
    // A classifier miss must degrade to "document + conversation", never to a
    // document-only prompt that can only answer with the refusal sentence.
    expect(classifyQuery('and in plain English', true)).toBe('both');
    expect(classifyQuery('and in plain English', false)).toBe('contract');
  });
});

describe('buildChatSystemPrompt — the refusal must not fire on the history path', () => {
  it('omits the document-only refusal instruction for history', () => {
    // RC1: class `history` correctly omits the document body, but the base
    // prompt still ordered the model to answer only from the document and to
    // reply with the exact refusal when it could not. With no document in
    // context, that instruction is the only one it can follow.
    const prompt = buildChatSystemPrompt('history');
    expect(prompt).not.toContain('Answer only from the document text provided');
    expect(prompt).not.toContain(CANNOT_FIND_ANSWER);
  });

  it('still grounds and still refuses for contract', () => {
    const prompt = buildChatSystemPrompt('contract');
    expect(prompt).toContain('Answer only from the document text provided');
    expect(prompt).toContain(CANNOT_FIND_ANSWER);
  });

  it('lets both answer from the conversation without dropping grounding', () => {
    const prompt = buildChatSystemPrompt('both');
    expect(prompt).toContain('Answer only from the document text provided');
    expect(prompt).toContain('conversation');
  });
});

describe('validateCitations — a history answer needs no page', () => {
  it('does not demand a citation for an answer about the conversation', () => {
    const result = validateCitations('You asked about the governing law.', 6, 'history');
    expect(result.needsRepair).toBe(false);
    expect(result.citationVerified).toBe(true);
  });
});

describe('validateCitations — every citation form the summary accepts (G44)', () => {
  it.each([
    ['a list', 'Based on the document, the cap applies. [Page 1, 5, 7]', [1, 5, 7]],
    ['a range', 'Based on the document, see the schedule. [Pages 3–4]', [3, 4]],
    ['a hyphen range', 'Based on the document, see the schedule. [Pages 3-4]', [3, 4]],
    ['repeated Page words', 'Based on the document, both apply. [Page 3, Page 5]', [3, 5]],
    ['a mix across brackets, deduped and sorted', 'It renews [Page 6] with notice [Pages 2–3] and [Page 3].', [2, 3, 6]],
  ])('accepts %s', (_label, content, pages) => {
    const result = validateCitations(content, 8, 'contract');
    expect(result.citedPages).toEqual(pages);
    expect(result.citationVerified).toBe(true);
    expect(result.needsRepair).toBe(false);
  });

  it('drops out-of-range pages from a multi-page citation and keeps the rest', () => {
    expect(validateCitations('See [Page 2, 9, 12].', 8, 'contract').citedPages).toEqual([2]);
    expect(validateCitations('See [Pages 7–10].', 8, 'contract').citedPages).toEqual([7, 8]);
  });

  it('a multi-page citation naming only out-of-range pages is no citation', () => {
    const result = validateCitations('See [Page 9, 12].', 8, 'contract');
    expect(result.citedPages).toEqual([]);
    expect(result.needsRepair).toBe(true);
  });

  it('the history rule is unchanged: no page demanded, none recorded', () => {
    expect(validateCitations('You asked about [Page 1, 5].', 8, 'history')).toEqual({
      citedPages: [],
      citationVerified: true,
      needsRepair: false,
    });
  });
});
