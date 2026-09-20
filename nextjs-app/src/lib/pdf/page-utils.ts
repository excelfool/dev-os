import { encodingForModel, getEncoding } from 'js-tiktoken';

/**
 * Helpers over the `[PAGE N]` marker format produced by extract-text.ts.
 * The literal marker form is depended on by the extraction prompt, the text
 * viewer and page attribution — do not change it here alone.
 */

export const PAGE_MARKER = /^\[PAGE (\d+)\]$/gm;

export interface PageSection {
  page: number;
  body: string;
}

export function splitPages(text: string): PageSection[] {
  const sections: PageSection[] = [];
  const matches = [...text.matchAll(/^\[PAGE (\d+)\]$/gm)];

  for (let i = 0; i < matches.length; i += 1) {
    const match = matches[i];
    if (!match || match.index === undefined) continue;
    const pageNumber = Number(match[1]);
    const bodyStart = match.index + match[0].length;
    const next = matches[i + 1];
    const bodyEnd = next?.index ?? text.length;
    sections.push({ page: pageNumber, body: text.slice(bodyStart, bodyEnd).trim() });
  }

  return sections;
}

/** The page of the nearest preceding marker for a character offset. */
export function pageOfOffset(text: string, offset: number): number {
  const matches = [...text.matchAll(/^\[PAGE (\d+)\]$/gm)];
  let page = 1;
  for (const match of matches) {
    if (match.index === undefined || match.index > offset) break;
    page = Number(match[1]);
  }
  return page;
}

let encoder: ReturnType<typeof getEncoding> | null = null;

/** Token estimate using o200k_base, the encoding GPT-4o uses. */
export function estimateTokens(text: string): number {
  if (!encoder) {
    try {
      encoder = encodingForModel('gpt-4o');
    } catch {
      encoder = getEncoding('o200k_base');
    }
  }
  return encoder.encode(text).length;
}
