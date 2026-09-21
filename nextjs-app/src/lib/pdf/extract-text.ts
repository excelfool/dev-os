import 'server-only';
import { sanitiseForLlm } from '@/lib/security/prompt-injection';

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

/**
 * pdfjs exception names that describe the DOCUMENT rather than the runtime.
 * `InvalidPDFException` is what a truncated file and non-PDF bytes both raise
 * ("Invalid PDF structure."); the others are the remaining document-level
 * classes pdfjs exports. Matched by name, not instanceof, because the class
 * objects live inside pdf-parse's nested pdfjs copy.
 */
const CORRUPT_DOCUMENT_EXCEPTIONS = new Set([
  'InvalidPDFException',
  'MissingPDFException',
  'PasswordException',
  'FormatError',
  'UnexpectedResponseException',
]);

const ZERO_WIDTH_AND_FORM_FEED = /[\f​-‍﻿]/g;

function normalisePageBody(raw: string): string {
  return raw
    .replace(ZERO_WIDTH_AND_FORM_FEED, '')
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Why this exists — the production-only upload 500 (2026-09-20).
 *
 * pdf-parse loads pdfjs's LEGACY build, and that build still evaluates
 * `const SCALE_MATRIX = new DOMMatrix()` at module top level. In Node, pdfjs
 * tries to supply DOMMatrix from `@napi-rs/canvas` via a dynamic
 * `createRequire(...)("@napi-rs/canvas")`. Netlify bundles this route with
 * `pdf-parse` marked external, so its tree ships through Next's file trace —
 * and the trace cannot follow that dynamic require, so the native canvas
 * binary never reaches the function. The require fails (pdfjs only warns),
 * the polyfill is skipped, and `import('pdf-parse')` itself throws
 * "ReferenceError: DOMMatrix is not defined". `next dev` runs unbundled from
 * node_modules where canvas resolves, which is why local never showed it.
 *
 * The legacy entry was the first preference and is already what is loaded;
 * it does not avoid the reference. pdfjs 6.x moved it off the top level, but
 * pdf-parse pins 5.4.296, and a cross-major override of a transitive
 * dependency is a larger risk than this. Shipping the ~10 MB canvas binary via
 * `included_files` was rejected too: text extraction never calls DOMMatrix,
 * so that would bundle a native library to define a class nothing invokes.
 *
 * So: the narrowest fix. Define DOMMatrix only if absent, only on the server,
 * right before the import. Where canvas does load, the guard leaves its real
 * DOMMatrix in place. Verified by running the real upload route in a Node
 * process with no DOM globals and `@napi-rs` hidden — the exact production
 * condition, which returned 500 before this and 201 after.
 *
 * The class is a 2D affine subset, enough that pdfjs's render-path helpers
 * would behave rather than explode if ever reached; `getText()` never reaches
 * them.
 */
function ensureDomMatrix(): void {
  if (typeof globalThis.DOMMatrix !== 'undefined') return;

  class MinimalDOMMatrix {
    a = 1; b = 0; c = 0; d = 1; e = 0; f = 0;

    constructor(init?: number[] | MinimalDOMMatrix) {
      if (Array.isArray(init)) {
        const [a, b, c, d, e, f] =
          init.length === 16 ? [init[0]!, init[1]!, init[4]!, init[5]!, init[12]!, init[13]!] : init;
        Object.assign(this, { a, b, c, d, e, f });
      } else if (init) {
        Object.assign(this, { a: init.a, b: init.b, c: init.c, d: init.d, e: init.e, f: init.f });
      }
    }

    get is2D() { return true; }
    get isIdentity() {
      return this.a === 1 && this.b === 0 && this.c === 0 && this.d === 1 && this.e === 0 && this.f === 0;
    }

    multiply(o: MinimalDOMMatrix) {
      return new MinimalDOMMatrix([
        this.a * o.a + this.c * o.b, this.b * o.a + this.d * o.b,
        this.a * o.c + this.c * o.d, this.b * o.c + this.d * o.d,
        this.a * o.e + this.c * o.f + this.e, this.b * o.e + this.d * o.f + this.f,
      ]);
    }
    preMultiplySelf(o: MinimalDOMMatrix) { Object.assign(this, o.multiply(this)); return this; }
    multiplySelf(o: MinimalDOMMatrix) { Object.assign(this, this.multiply(o)); return this; }
    translate(tx = 0, ty = 0) { return this.multiply(new MinimalDOMMatrix([1, 0, 0, 1, tx, ty])); }
    scale(sx = 1, sy = sx) { return this.multiply(new MinimalDOMMatrix([sx, 0, 0, sy, 0, 0])); }
    inverse() {
      const det = this.a * this.d - this.b * this.c;
      if (det === 0) return new MinimalDOMMatrix([NaN, NaN, NaN, NaN, NaN, NaN]);
      return new MinimalDOMMatrix([
        this.d / det, -this.b / det, -this.c / det, this.a / det,
        (this.c * this.f - this.d * this.e) / det, (this.b * this.e - this.a * this.f) / det,
      ]);
    }
    invertSelf() { Object.assign(this, this.inverse()); return this; }
    toFloat32Array() { return new Float32Array([this.a, this.b, this.c, this.d, this.e, this.f]); }
  }

  (globalThis as unknown as { DOMMatrix: unknown }).DOMMatrix = MinimalDOMMatrix;
}

export async function extractPdfText(buffer: Buffer): Promise<ExtractedPdf> {
  ensureDomMatrix();
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

    // A contract body is attacker-controlled, and `[PAGE N]` is load-bearing:
    // the extraction prompt, the citation validator and page-utils all trust a
    // whole-line marker to attribute a citation to a page. A PDF containing a
    // literal "[PAGE 99]" line could therefore move a citation to a page the
    // text is not on. Forgeries are defanged HERE, before the genuine markers
    // are inserted — the only point at which the two are still distinguishable.
    const text = bodies
      .map((body, index) => `[PAGE ${index + 1}]\n${sanitiseForLlm(body)}`)
      .join('\n\n');

    const withoutMarkers = text.replace(/^\[PAGE \d+\]$/gm, ' ');
    const wordCount = withoutMarkers.split(/\s+/).filter(Boolean).length;

    return { text, pageCount, wordCount };
  } catch (err) {
    // Only pdfjs's own DOCUMENT exceptions mean the file is bad. Anything else —
    // a missing runtime global, a bundle without the worker or its font data, a
    // failed fake-worker setup — is a defect in our runtime, and mapping it here
    // told the user their file was corrupt (live site, 2026-09-20). Those are
    // rethrown so they surface as INTERNAL with the real message in the log.
    if (err instanceof Error && CORRUPT_DOCUMENT_EXCEPTIONS.has(err.name)) {
      throw new CorruptPdfError(err.message);
    }
    throw err;
  } finally {
    await parser.destroy().catch(() => {
      /* nothing actionable if teardown fails */
    });
  }
}
