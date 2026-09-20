import { describe, expect, it } from 'vitest';
import { classifyQuery } from '@/lib/ai/query-classifier';
import { validateCitations, isCannotFindAnswer, truncateHistory } from '@/lib/services/chat-service';

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
