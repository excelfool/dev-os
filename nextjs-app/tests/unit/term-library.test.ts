import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  MSA_TERMS,
  NDA_TERMS,
  TERM_LIBRARY_VERSION,
  MSA_LIBRARY_SOURCE_VERSION,
  displayRankFor,
  isStandardTerm,
  isRequiredTerm,
} from '@/lib/ai/term-library';

/** Spec 05 v1.1 §D. */

const REFERENCE = resolve(process.cwd(), '../docs/reference/key-terms-msa-instructor.json');
const COPY = resolve(process.cwd(), 'src/lib/ai/term-library/msa-instructor.json');

describe('term library v1.1', () => {
  it('the src copy of the instructor file is byte-identical to docs/reference', () => {
    expect(readFileSync(COPY)).toEqual(readFileSync(REFERENCE));
  });

  it('MSA has exactly the 36 instructor terms in display_rank order 1–36, byte-equal on the four fields', () => {
    const ref = JSON.parse(readFileSync(REFERENCE, 'utf8')) as {
      terms: Array<{ term_id: number; term_name: string; question: string; answer_format: string; display_rank: number }>;
    };
    expect(MSA_TERMS).toHaveLength(36);
    expect(MSA_TERMS.map((t) => t.display_rank)).toEqual(Array.from({ length: 36 }, (_, i) => i + 1));
    const byId = new Map(ref.terms.map((t) => [t.term_id, t]));
    for (const term of MSA_TERMS) {
      const r = byId.get(term.term_id)!;
      expect(term.term_name).toBe(r.term_name);
      expect(term.question).toBe(r.question);
      expect(term.answer_format).toBe(r.answer_format);
      expect(term.display_rank).toBe(r.display_rank);
    }
  });

  it('NDA has exactly the 10 v1.0 names, unchanged', () => {
    expect(NDA_TERMS.map((t) => t.term_name)).toEqual([
      'Parties', 'Effective Date', 'Confidentiality Obligations', 'Permitted Disclosures',
      'Term & Duration', 'Governing Law', 'Jurisdiction', 'IP Ownership', 'Non-Solicitation',
      'Breach & Remedy',
    ]);
  });

  it('every term has a non-empty tooltip, question and answer format', () => {
    for (const t of [...NDA_TERMS, ...MSA_TERMS]) {
      expect(t.tooltip.length, t.term_name).toBeGreaterThan(0);
      expect(t.question.length, t.term_name).toBeGreaterThan(0);
      expect(t.answer_format.length, t.term_name).toBeGreaterThan(0);
    }
  });

  it('the required set is {1,2,3} for MSA and {Parties, Effective Date} for NDA', () => {
    expect(MSA_TERMS.filter((t) => t.is_required).map((t) => t.term_id)).toEqual([1, 2, 3]);
    expect(NDA_TERMS.filter((t) => t.is_required).map((t) => t.term_name)).toEqual(['Parties', 'Effective Date']);
    expect(isRequiredTerm('MSA', 'customer name')).toBe(true);
    expect(isRequiredTerm('MSA', 'Deal Value')).toBe(false);
  });

  it('versions', () => {
    expect(TERM_LIBRARY_VERSION).toBe('v1.1');
    expect(MSA_LIBRARY_SOURCE_VERSION).toBe('instructor-2026-09');
  });

  it('displayRankFor / isStandardTerm behave as before', () => {
    expect(displayRankFor('MSA', 'Governing Law')).toBe(7);
    expect(displayRankFor('NDA', 'governing law')).toBe(6);
    expect(displayRankFor('MSA', 'Non-compete radius')).toBe(99);
    expect(isStandardTerm('MSA', 'Governing Law')).toBe(true);
    expect(isStandardTerm('MSA', 'Service Scope')).toBe(false);
  });
});
