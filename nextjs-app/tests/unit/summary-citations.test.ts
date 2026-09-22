import { describe, expect, it } from 'vitest';
import {
  citedPages,
  countWords,
  enforceWordBudget,
  hasValidCitation,
  isFactualSentence,
  normaliseMarkdown,
  splitSentences,
  uncitedFactualSentences,
} from '@/lib/ai/summary-validation';

/** Spec 06 v1.1 §E — the factual-sentence detector and the repair trigger. */

const ctx = { pageCount: 8, facts: ['Acme Corp', 'Beta Ltd', 'Net 30'] };

describe('factual-sentence detector', () => {
  it('a sentence with a digit is factual', () => {
    expect(isFactualSentence('Payment is due within 30 days.', ctx)).toBe(true);
  });
  it('a sentence naming a party or a term value is factual', () => {
    expect(isFactualSentence('Acme Corp provides the services.', ctx)).toBe(true);
    expect(isFactualSentence('Invoices are payable on Net 30 terms.', ctx)).toBe(true);
  });
  it('a general sentence is not factual', () => {
    expect(isFactualSentence('This is a services agreement between two companies.', ctx)).toBe(false);
  });
  it('digits inside the citation itself do not make a sentence factual', () => {
    expect(isFactualSentence('The parties agree to cooperate. [Page 2]', ctx)).toBe(false);
  });
});

describe('citation validity', () => {
  it('accepts [Page X] within 1..page_count and rejects outside', () => {
    expect(hasValidCitation('Due in 30 days. [Page 3]', 8)).toBe(true);
    expect(hasValidCitation('Due in 30 days. [Page 9]', 8)).toBe(false);
    expect(hasValidCitation('Due in 30 days. [page 1]', 8)).toBe(true);
  });
});

describe('repair trigger', () => {
  it('lists factual sentences that lack a valid citation', () => {
    const md = [
      'This agreement is between Acme Corp and Beta Ltd. [Page 1]',
      'Fees are $12,000 per year.',
      '**Obligations of Acme Corp:**',
      '- Deliver the services within 30 days. [Page 4]',
      '- Keep data confidential.',
      '- Notify breaches within 72 hours. [Page 12]',
    ].join('\n');
    const missing = uncitedFactualSentences(md, ctx);
    expect(missing).toEqual([
      'Fees are $12,000 per year.',
      '**Obligations of Acme Corp:**',
      '- Notify breaches within 72 hours. [Page 12]',
    ]);
  });

  it('returns nothing when every factual sentence is cited', () => {
    const md = 'Acme Corp pays Beta Ltd. [Page 1]\n- 30 days notice. [Page 2]';
    expect(uncitedFactualSentences(md, ctx)).toEqual([]);
  });
});

describe('word budget and normalisation', () => {
  it('keeps a summary within 220 words untouched', () => {
    const md = 'Short summary. [Page 1]';
    expect(enforceWordBudget(md)).toBe(md);
  });
  it('truncates at the last complete bullet when over budget', () => {
    const intro = Array.from({ length: 200 }, () => 'word').join(' ') + '.';
    const md = `${intro}\n- one two three four five six seven eight nine ten. [Page 1]\n- eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty. [Page 2]`;
    const out = enforceWordBudget(md);
    expect(countWords(out)).toBeLessThanOrEqual(220);
    expect(out.endsWith('[Page 1]')).toBe(true);
  });
  it('demotes headings to bold and strips code fences', () => {
    expect(normaliseMarkdown('# Summary\n```markdown\nBody. [Page 1]\n```')).toBe('**Summary**\nBody. [Page 1]');
  });
  it('splits prose into sentences and keeps bullets whole', () => {
    expect(splitSentences('One thing. [Page 1] Another thing.\n- a bullet. with a dot')).toEqual([
      'One thing. [Page 1]',
      'Another thing.',
      '- a bullet. with a dot',
    ]);
  });
});

/**
 * L8 (spec 07 v1.1 5d-2b). The model writes multi-page citations —
 * "[Page 1, 5, 7]", "[Pages 3–4]" — and the single-page regex matched none of
 * them. Two consequences, both seen live on contract 93ba9b49: the card
 * rendered the citation as raw text instead of chips, and the validator
 * counted the sentence as UNCITED, which triggered a needless repair call and
 * could flag a correctly cited summary as `summary_uncited`.
 */
describe('multi-page citations (L8)', () => {
  it.each([
    ['[Page 2]', [2]],
    ['[Page 1, 5, 7]', [1, 5, 7]],
    ['[Pages 3-4]', [3, 4]],
    ['[Pages 3–4]', [3, 4]],
    ['[Page 3, Page 5]', [3, 5]],
    ['[Pages 1 and 2]', [1, 2]],
    ['[Page 4, 4]', [4]],
  ])('reads the pages out of %s', (citation, expected) => {
    expect(citedPages(`The fee is 500 dollars. ${citation}`)).toEqual(expected);
  });

  it('collects pages across several citations in one sentence', () => {
    expect(citedPages('Fees [Page 2] and term [Page 5, 6].')).toEqual([2, 5, 6]);
  });

  it('finds no pages where there is no citation', () => {
    expect(citedPages('The fee is 500 dollars.')).toEqual([]);
  });

  it('counts a multi-page citation as cited', () => {
    expect(hasValidCitation('The fee is 500 dollars. [Page 1, 5, 7]', 8)).toBe(true);
    expect(hasValidCitation('The term runs two years. [Pages 3–4]', 8)).toBe(true);
  });

  it('still rejects a citation naming only pages past the end of the document', () => {
    expect(hasValidCitation('The fee is 500 dollars. [Page 30, 31]', 8)).toBe(false);
  });

  it('accepts a citation where only one of several pages is in range', () => {
    expect(hasValidCitation('The fee is 500 dollars. [Page 5, 99]', 8)).toBe(true);
  });

  it('does not ask for a repair on a sentence cited across pages', () => {
    const md = 'Harborlight must keep the information confidential for 2 years. [Page 1, 5, 7]';

    expect(uncitedFactualSentences(md, { pageCount: 8, facts: ['Harborlight'] })).toEqual([]);
  });

  it('does not let the digits inside a citation make a sentence look factual', () => {
    // Stripping must remove the whole multi-page citation, not part of it.
    expect(isFactualSentence('The parties agree as follows. [Page 1, 5, 7]', { pageCount: 8, facts: [] })).toBe(false);
  });

  it('keeps a multi-page citation attached to its sentence when splitting', () => {
    const units = splitSentences('Fees are due in 30 days. [Page 1, 5] The term is two years. [Page 6]');

    expect(units).toHaveLength(2);
    expect(units[0]).toContain('[Page 1, 5]');
  });
});
