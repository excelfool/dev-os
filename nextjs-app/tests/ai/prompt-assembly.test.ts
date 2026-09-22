import { describe, expect, it } from 'vitest';
import {
  buildExtractionSystemPrompt,
  FEW_SHOT_EXAMPLES,
  renderTargetTerm,
} from '@/lib/ai/prompts/extraction.v2';
import { DEFAULT_ANSWER_FORMAT, MSA_TERMS, NDA_TERMS } from '@/lib/ai/term-library';

/** The target-list section only — the grounding rules are bullets too. */
function targetBullets(prompt: string): number {
  const start = prompt.indexOf('Extract these ');
  const end = prompt.indexOf('Return a single JSON object');
  return prompt.slice(start, end).match(/^- /gm)?.length ?? 0;
}

/** Spec 06 v1.1 §E — the v2 prompt asks every term's question and answer format. */

describe('extraction.v2 prompt assembly', () => {
  it('lists every MSA term with its verbatim question and answer format (36 targets)', () => {
    const prompt = buildExtractionSystemPrompt('MSA', []);
    expect(MSA_TERMS).toHaveLength(36);
    for (const term of MSA_TERMS) {
      expect(prompt).toContain(renderTargetTerm(term));
      expect(prompt).toContain(`Question: ${term.question}`);
      expect(prompt).toContain(`Answer format: ${term.answer_format}`);
    }
    expect(targetBullets(prompt)).toBe(36);
  });

  it('lists every NDA term with its question and answer format (10 targets)', () => {
    const prompt = buildExtractionSystemPrompt('NDA', []);
    expect(NDA_TERMS).toHaveLength(10);
    for (const term of NDA_TERMS) expect(prompt).toContain(renderTargetTerm(term));
    expect(targetBullets(prompt)).toBe(10);
    // The MSA few-shot block is always present; the TARGET list must not name MSA terms.
    const targets = prompt.slice(prompt.indexOf('Extract these '), prompt.indexOf('Return a single JSON object'));
    expect(targets).not.toContain('Service Provider Name');
  });

  it('custom terms are appended with the default answer format', () => {
    const prompt = buildExtractionSystemPrompt('NDA', ['Survival period']);
    expect(prompt).toContain('Additional terms the user asked for:');
    expect(prompt).toContain(`- Survival period\n  Answer format: ${DEFAULT_ANSWER_FORMAT}`);
    expect(targetBullets(prompt)).toBe(11);
  });

  it('every few-shot example object carries a one-sentence reasoning', () => {
    const examples = [...FEW_SHOT_EXAMPLES.NDA, ...FEW_SHOT_EXAMPLES.MSA];
    expect(examples).toHaveLength(6);
    for (const example of examples) {
      for (const term of example.output.terms) {
        expect(typeof term.reasoning).toBe('string');
        expect((term.reasoning as string).length).toBeGreaterThan(10);
      }
    }
    const prompt = buildExtractionSystemPrompt('MSA', []);
    expect(prompt).toContain('"reasoning": "string|null"');
    expect(prompt).toContain('reasoning is one sentence explaining why the value answers the question');
    expect(prompt).toContain('exactly as a careful paralegal would');
  });

  it('MSA few-shot examples use instructor term names only', () => {
    const names = new Set(MSA_TERMS.map((t) => t.term_name));
    for (const example of FEW_SHOT_EXAMPLES.MSA) {
      for (const term of example.output.terms) expect(names.has(term.term_name), term.term_name).toBe(true);
    }
  });
});
