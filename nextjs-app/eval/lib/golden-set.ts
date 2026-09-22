import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { MSA_TERMS } from '@/lib/ai/term-library';
import type { LabelledTerm } from './types';

/**
 * Golden-set loader (spec 22 §1): maps each instructor contract to the spec 17
 * label shape. `term_name` is matched EXACTLY against the 36-term library and
 * the loader fails loudly on any name not in it, so the two files cannot
 * silently diverge.
 */

export interface GoldenContract {
  contract_id: string; // the instructor tab
  contract_name: string;
  pdf_source_url: string;
  contract_type: 'MSA';
  terms: Array<LabelledTerm & { question: string }>;
}

interface GoldenFile {
  name: string;
  version: string;
  contracts: Array<{
    contract_name: string;
    tab: string;
    pdf_source_url: string;
    contract_type: string;
    terms: Array<{
      term_name: string;
      benchmark_answer: string | null;
      benchmark_location: string | null;
      question_as_asked: string;
    }>;
  }>;
}

export const GOLDEN_SET_PATH = resolve(process.cwd(), 'eval/datasets/msa-instructor/golden-set.json');

/** "Page 3" → 3; "Page 3, 5" → 3; "Page 3-4" → 3; unparseable → null. */
export function parsePage(location: string | null | undefined): number | null {
  if (!location) return null;
  const match = location.match(/(\d+)/);
  return match ? Number(match[1]) : null;
}

function normaliseExpected(answer: string | null | undefined): string | null {
  if (answer === null || answer === undefined) return null;
  const trimmed = String(answer).trim();
  if (trimmed.length === 0) return null;
  if (/^(n\/?a|none|not found|not specified|null)$/i.test(trimmed)) return null;
  return trimmed;
}

export function loadGoldenSet(path: string = GOLDEN_SET_PATH): { version: string; contracts: GoldenContract[] } {
  const file = JSON.parse(readFileSync(path, 'utf8')) as GoldenFile;
  const library = new Set(MSA_TERMS.map((t) => t.term_name));

  const contracts = file.contracts.map((c) => {
    const unknown = c.terms.map((t) => t.term_name).filter((name) => !library.has(name));
    if (unknown.length > 0) {
      throw new Error(
        `golden-set.json tab "${c.tab}" names terms not in the 36-term library: ${unknown.join(', ')}`,
      );
    }
    return {
      contract_id: c.tab,
      contract_name: c.contract_name,
      pdf_source_url: c.pdf_source_url,
      contract_type: 'MSA' as const,
      terms: c.terms.map((t) => ({
        term_name: t.term_name,
        expected_value: normaliseExpected(t.benchmark_answer),
        expected_page: parsePage(t.benchmark_location),
        question: t.question_as_asked,
      })),
    };
  });

  return { version: file.version, contracts };
}
