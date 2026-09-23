/**
 * Summary validation (spec 06 v1.1 §B "Validation"): word budget and the
 * factual-sentence citation rule. Pure functions — unit-tested without a model.
 */

import { CITATION, citedPagesIn } from '@/lib/ai/citations';

export const SUMMARY_MAX_WORDS = 220;

export function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

/** Splits Markdown into sentence-ish units, keeping bullets as their own units. */
export function splitSentences(markdown: string): string[] {
  const units: string[] = [];
  for (const line of markdown.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    if (/^[-*•]\s/.test(trimmed)) {
      units.push(trimmed);
      continue;
    }
    // Split prose on sentence terminators followed by whitespace; a citation
    // may sit after the terminator ("… fees. [Page 3]") so keep it attached.
    for (const part of trimmed.split(/(?<=[.!?](?:\s*\[Pages?\s+[^\]]*\d[^\]]*\])?)\s+(?=[A-Z*"'(])/)) {
      if (part.trim().length > 0) units.push(part.trim());
    }
  }
  return units;
}

export function citedPages(sentence: string): number[] {
  return citedPagesIn(sentence);
}

export interface FactualContext {
  pageCount: number;
  /** Party names and term values the model may restate. */
  facts: string[];
}

/** A sentence is factual when it carries a digit, a party name or a term value. */
export function isFactualSentence(sentence: string, ctx: FactualContext): boolean {
  const stripped = sentence.replace(CITATION, '');
  if (/\d/.test(stripped)) return true;
  const lower = stripped.toLowerCase();
  return ctx.facts.some((f) => f.length >= 4 && lower.includes(f.toLowerCase()));
}

/** True when the sentence has at least one citation with 1 ≤ X ≤ pageCount. */
export function hasValidCitation(sentence: string, pageCount: number): boolean {
  return citedPages(sentence).some((p) => p >= 1 && p <= pageCount);
}

/** Factual sentences that lack a valid [Page X] citation. */
export function uncitedFactualSentences(markdown: string, ctx: FactualContext): string[] {
  return splitSentences(markdown).filter(
    (s) => isFactualSentence(s, ctx) && !hasValidCitation(s, ctx.pageCount),
  );
}

/** Word budget: over 220 words ⇒ truncated at the last complete bullet (or word). */
export function enforceWordBudget(markdown: string, maxWords = SUMMARY_MAX_WORDS): string {
  if (countWords(markdown) <= maxWords) return markdown.trim();
  const lines = markdown.split('\n');
  const kept: string[] = [];
  let words = 0;
  for (const line of lines) {
    const n = countWords(line);
    if (words + n > maxWords) break;
    kept.push(line);
    words += n;
  }
  // Drop a trailing partial (non-bullet) fragment only if a bullet list follows it.
  if (kept.length === 0) {
    return markdown.trim().split(/\s+/).slice(0, maxWords).join(' ');
  }
  return kept.join('\n').trim();
}

/** Bullets / bold headings the model may emit as "# Heading" are demoted to bold. */
export function normaliseMarkdown(markdown: string): string {
  return markdown
    .replace(/^\s*#{1,6}\s+(.+)$/gm, '**$1**')
    .replace(/^```[a-z]*\n?|```$/gm, '')
    .trim();
}
