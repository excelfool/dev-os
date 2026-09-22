import { describe, expect, it } from 'vitest';
import {
  processExtraction,
  truncateReasoning,
  REASONING_MAX_CHARS,
} from '@/lib/services/extraction-service';
import { MSA_TERMS, NDA_TERMS, TERM_LIBRARY_VERSION } from '@/lib/ai/term-library';

/** Spec 06 §9 + v1.1 §E. */

const TEXT = `[PAGE 1]
This Agreement is governed by the laws of the State of Delaware.
This Mutual Non-Disclosure Agreement is entered into as of 11 February 2025 between Acme Corp and Beta Ltd.`;

function process(terms: unknown[], contractType: 'NDA' | 'MSA' = 'NDA') {
  const library = contractType === 'NDA' ? NDA_TERMS : MSA_TERMS;
  return processExtraction({
    raw: { detected_type: contractType, terms },
    contractType,
    contractText: TEXT,
    pageCount: 1,
    requestedStandardTerms: library.map((t) => t.term_name),
    requestedCustomTerms: [],
  });
}

describe('reasoning truncation (spec 06 v1.1 §A)', () => {
  it('keeps reasoning ≤ 500 chars untouched', () => {
    const r = truncateReasoning('Clause 9 names Delaware law.');
    expect(r).toEqual({ reasoning: 'Clause 9 names Delaware law.', truncated: false });
  });

  it('truncates at the last sentence boundary inside 500 chars and counts it', () => {
    const sentence = 'The clause states the governing law. ';
    const long = sentence.repeat(20); // 740 chars
    const r = truncateReasoning(long);
    expect(r.truncated).toBe(true);
    expect(r.reasoning!.length).toBeLessThanOrEqual(REASONING_MAX_CHARS);
    expect(r.reasoning!.endsWith('.')).toBe(true);
    expect(r.reasoning!.length).toBe(sentence.trim().length * 13 + 12); // 13 whole sentences
  });

  it('hard-cuts at 500 when there is no sentence boundary', () => {
    const r = truncateReasoning('x'.repeat(600));
    expect(r.truncated).toBe(true);
    expect(r.reasoning!.length).toBe(REASONING_MAX_CHARS);
  });

  it('null, undefined and blank become null', () => {
    expect(truncateReasoning(null).reasoning).toBeNull();
    expect(truncateReasoning(undefined).reasoning).toBeNull();
    expect(truncateReasoning('   ').reasoning).toBeNull();
  });

  it('processExtraction truncates and counts, and stamps the library version', () => {
    const out = process([
      {
        term_name: 'Governing Law',
        value: 'State of Delaware',
        page_number: 1,
        confidence_score: 0.9,
        source_sentence: 'This Agreement is governed by the laws of the State of Delaware.',
        reasoning: 'Because it says so. '.repeat(40),
      },
    ]);
    const gl = out.terms.find((t) => t.term_name === 'Governing Law')!;
    expect(out.reasoningTruncatedCount).toBe(1);
    expect(gl.reasoning!.length).toBeLessThanOrEqual(500);
    expect(gl.term_library_version).toBe(TERM_LIBRARY_VERSION);
    expect(gl.is_required).toBe(false);
  });
});

describe('originals at insert', () => {
  it('the persist payload carries value, page and reasoning so the RPC captures original_ai_* at insert', () => {
    const out = process([
      {
        term_name: 'Effective Date',
        value: '2025-02-11',
        page_number: 1,
        confidence_score: 0.92,
        source_sentence:
          'This Mutual Non-Disclosure Agreement is entered into as of 11 February 2025 between Acme Corp and Beta Ltd.',
        reasoning: 'The recital dates the agreement 11 February 2025.',
      },
    ]);
    const ed = out.terms.find((t) => t.term_name === 'Effective Date')!;
    expect(ed).toMatchObject({
      value: '2025-02-11',
      page_number: 1,
      reasoning: 'The recital dates the agreement 11 February 2025.',
      is_required: true,
    });
  });

  it('a v1-shaped item without reasoning still parses, with reasoning null', () => {
    const out = process([
      {
        term_name: 'Governing Law',
        value: 'State of Delaware',
        page_number: 1,
        confidence_score: 0.9,
        source_sentence: 'This Agreement is governed by the laws of the State of Delaware.',
      },
    ]);
    expect(out.droppedTermCount).toBe(0);
    expect(out.terms.find((t) => t.term_name === 'Governing Law')!.reasoning).toBeNull();
  });
});

describe('required_missing (spec 06 v1.1 §C)', () => {
  it('lists a null required term and not a null optional one', () => {
    // Model returns nothing: every NDA term is inserted at 0%.
    const out = process([]);
    expect(out.requiredMissing).toEqual(['Parties', 'Effective Date']);
    expect(out.requiredMissing).not.toContain('Governing Law');
  });

  it('a found required term is not listed', () => {
    const out = process([
      {
        term_name: 'Parties',
        value: 'Acme Corp and Beta Ltd',
        page_number: 1,
        confidence_score: 0.95,
        source_sentence:
          'This Mutual Non-Disclosure Agreement is entered into as of 11 February 2025 between Acme Corp and Beta Ltd.',
        reasoning: 'The recital names both parties.',
      },
    ]);
    expect(out.requiredMissing).toEqual(['Effective Date']);
  });

  it('MSA: Service Provider Name, Customer Name and Contract start date are the required set', () => {
    const out = process([], 'MSA');
    expect(out.requiredMissing).toEqual(['Service Provider Name', 'Customer Name', 'Contract start date']);
    expect(out.terms).toHaveLength(36);
  });
});
