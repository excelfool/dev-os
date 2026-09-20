import 'server-only';

/**
 * Text extraction, performed exactly once at upload (spec 04 §3).
 *
 * `contracts.contract_text` is the single source of truth for every AI call —
 * neither processing nor chat re-downloads the PDF.
 *
 * Spec 04 §3 was written against pdf-parse v1, whose `pagerender` callback was
 * the only way to keep page boundaries exact. The installed v2 returns
 * page-wise text natively (`TextResult.pages[]`), which satisfies the same
 * requirement directly, so that is what is used here.
 */

export interface ExtractedPdf {
  /** "[PAGE 1]\n…\n\n[PAGE 2]\n…" — markers are 1-indexed and on their own line. */
  text: string;
  pageCount: number;
  /** Word count of the joined text, excluding the [PAGE N] markers. */
  wordCount: number;
}

export class CorruptPdfError extends Error {}

const ZERO_WIDTH_AND_FORM_FEED = /[\f​-‍﻿]/g;

function normalisePageBody(raw: string): string {
  return raw
    .replace(ZERO_WIDTH_AND_FORM_FEED, '')
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export async function extractPdfText(buffer: Buffer): Promise<ExtractedPdf> {
  const { PDFParse } = await import('pdf-parse');

  const parser = new PDFParse({ data: new Uint8Array(buffer) });

  try {
    const result = await parser.getText();
    const pageCount = result.total;

    const bodies: string[] = [];
    for (let page = 1; page <= pageCount; page += 1) {
      // A page with no text layer still emits its marker, so numbering never
      // drifts against the model's page_number output.
      const found = result.pages.find((p) => p.num === page);
      bodies.push(normalisePageBody(found?.text ?? ''));
    }

    const text = bodies.map((body, index) => `[PAGE ${index + 1}]\n${body}`).join('\n\n');

    const withoutMarkers = text.replace(/^\[PAGE \d+\]$/gm, ' ');
    const wordCount = withoutMarkers.split(/\s+/).filter(Boolean).length;

    return { text, pageCount, wordCount };
  } catch (err) {
    throw new CorruptPdfError(err instanceof Error ? err.message : 'unreadable PDF');
  } finally {
    await parser.destroy().catch(() => {
      /* nothing actionable if teardown fails */
    });
  }
}
