import type { PersistableTerm } from '@/lib/services/extraction-service';

/**
 * Contract summary prompt (spec 06 v1.1 §B, US-015). D45 (2026-09-21): the
 * input is the FULL contract_text with [PAGE N] markers plus the persisted
 * terms as compact JSON — not a 3,000-token window.
 */

export const SUMMARY_PROMPT_VERSION = 'summary.v1';

export const SUMMARY_SYSTEM_PROMPT = `Write a plain-language summary of this contract for a non-lawyer in at most 200 words. Structure: one paragraph on what the agreement is, then a bullet list "**Obligations of {party}:**" for each party you can identify from the terms. Every sentence that states a fact from the contract must end with a [Page X] citation taken from the term's page or the page marker in the document. Use only the terms and document provided. Do not give advice. Output Markdown only — no headings, no preamble.`;

export const SUMMARY_REPAIR_PROMPT =
  'Add a [Page X] citation to every factual sentence; change nothing else. Return the full summary.';

export function compactTerms(
  terms: Array<Pick<PersistableTerm, 'term_name' | 'value' | 'page_number' | 'source_sentence'>>,
): string {
  return JSON.stringify(
    terms
      .filter((t) => t.value !== null)
      .map((t) => ({
        term_name: t.term_name,
        value: t.value,
        page_number: t.page_number,
        source_sentence: t.source_sentence,
      })),
  );
}

export function buildSummaryUserMessage(contractText: string, terms: Parameters<typeof compactTerms>[0]): string {
  return `Extracted terms (JSON):\n${compactTerms(terms)}\n\nContract text:\n${contractText}`;
}
