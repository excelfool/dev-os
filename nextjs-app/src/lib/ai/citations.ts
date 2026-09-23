/**
 * The one citation parser (G44), shared by the summary (spec 06 v1.1 §B), the
 * summary card and chat (spec 08 §6). Moved here from summary-validation.ts so
 * chat accepts the same forms the summary does.
 */

/**
 * A whole citation bracket (L8, spec 07 v1.1 5d-2b).
 *
 * The model does not only write `[Page 3]`. It writes `[Page 1, 5, 7]`,
 * `[Pages 3–4]` and `[Page 3, Page 5]`, and a single-page pattern matched none
 * of those: live, the card rendered them as raw text and the validator counted
 * a properly cited sentence as uncited, asking for a repair it did not need.
 *
 * The bracket must contain at least one digit, so ordinary bracketed prose is
 * not swallowed.
 */
export const CITATION = /\[Pages?\s+[^\]]*\d[^\]]*\]/gi;

/** Page numbers named by ONE citation bracket, in the order written. */
export function parseCitationPages(citation: string): number[] {
  // Drop the brackets and every "Page"/"Pages" word, leaving the numbers,
  // their separators and any range dashes.
  const inner = citation.replace(/^\[|\]$/g, '').replace(/pages?/gi, ' ');
  const pages: number[] = [];
  const token = /(\d+)\s*(?:[-–—]\s*(\d+))?/g;

  let match: RegExpExecArray | null;
  while ((match = token.exec(inner)) !== null) {
    const from = Number(match[1]);
    const to = match[2] ? Number(match[2]) : from;
    // A range runs upwards and stays sane; anything else is read as one page.
    if (to > from && to - from <= MAX_CITATION_RANGE) {
      for (let page = from; page <= to; page += 1) pages.push(page);
    } else {
      pages.push(from);
    }
  }

  return [...new Set(pages)];
}

/** A citation spanning more pages than this is a misparse, not a range. */
const MAX_CITATION_RANGE = 50;

/** Every page a text cites, across all its citation brackets, unique, in the order first written. */
export function citedPagesIn(text: string): number[] {
  return [...new Set([...text.matchAll(CITATION)].flatMap((m) => parseCitationPages(m[0])))];
}
