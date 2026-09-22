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

// ---------------------------------------------------------------------------
// D47 option c — lean anchors and parallel batches (spec 06 v1.1 §G)
// ---------------------------------------------------------------------------
import { mergeExtractions, planExtractionBatches, SOURCE_ANCHOR_MAX_WORDS } from '@/lib/services/extraction-service';

describe('source_anchor (D47 c)', () => {
  it('a v2 source_anchor is verified and stored as source_sentence', () => {
    const out = process([
      {
        term_name: 'Governing Law',
        value: 'State of Delaware',
        page_number: 1,
        confidence_score: 0.9,
        source_anchor: 'governed by the laws of the State of Delaware',
        reasoning: 'Clause names Delaware.',
      },
    ]);
    const gl = out.terms.find((t) => t.term_name === 'Governing Law')!;
    expect(gl.source_sentence).toBe('governed by the laws of the State of Delaware');
    expect(gl.is_source_verified).toBe(true);
    expect(gl.confidence_score).toBe(90);
    expect(out.anchorOverLimitCount).toBe(0);
  });

  it('an anchor over 25 words is accepted (schema) and counted', () => {
    const longAnchor = Array.from({ length: SOURCE_ANCHOR_MAX_WORDS + 5 }, (_, i) => `w${i}`).join(' ');
    const out = process([
      { term_name: 'Governing Law', value: 'Delaware', page_number: 1, confidence_score: 0.9, source_anchor: longAnchor },
    ]);
    expect(out.droppedTermCount).toBe(0);
    expect(out.anchorOverLimitCount).toBe(1);
    expect(out.terms.find((t) => t.term_name === 'Governing Law')!.source_sentence).toBe(longAnchor);
  });
});

describe('batching (D47 c)', () => {
  it('MSA splits 1–18 / 19–36 with custom terms on batch 2; NDA is one batch', () => {
    const msa = planExtractionBatches('MSA', ['Non-compete radius']);
    expect(msa).toHaveLength(2);
    expect(msa[0]!.standardTermNames).toHaveLength(18);
    expect(msa[1]!.standardTermNames).toHaveLength(18);
    expect(msa[0]!.standardTermNames[0]).toBe('Service Provider Name');
    expect(msa[1]!.standardTermNames[0]).toBe('Notice of termination for convenience (Days)');
    expect(msa[0]!.customTermNames).toEqual([]);
    expect(msa[1]!.customTermNames).toEqual(['Non-compete radius']);
    const nda = planExtractionBatches('NDA', ['X']);
    expect(nda).toHaveLength(1);
    expect(nda[0]!.standardTermNames).toHaveLength(10);
  });

  it('merge: first batch wins detected_type, disagreement flagged, counts summed, terms deduped and sorted', () => {
    const a = process([], 'MSA');
    const b = { ...process([], 'MSA'), detectedType: 'NDA' as const, droppedTermCount: 2 };
    const merged = mergeExtractions([{ ...a, droppedTermCount: 1 }, b], 'MSA');
    expect(merged.detectedType).toBe('MSA');
    expect(merged.typeMismatch).toBe(false);
    expect(merged.typeDisagreement).toBe(true);
    expect(merged.droppedTermCount).toBe(3);
    expect(merged.terms).toHaveLength(36);
    expect(merged.terms.map((t) => t.display_rank)).toEqual(Array.from({ length: 36 }, (_, i) => i + 1));
    expect(merged.requiredMissing).toEqual(['Service Provider Name', 'Customer Name', 'Contract start date']);
  });
});
