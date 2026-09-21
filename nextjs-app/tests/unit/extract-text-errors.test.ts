import { describe, expect, it, vi } from 'vitest';

/**
 * Netlify, 2026-09-20: a PDF that parses locally returned 422 CORRUPT_PDF on
 * the live site. The parse failed on a runtime gap in the function bundle —
 * the same class of defect as the DOMMatrix import failure, one stage later —
 * and extract-text mapped EVERY thrown error to CorruptPdfError, so a runtime
 * defect showed the user a message blaming their file.
 *
 * Only pdfjs's own document exceptions mean the file is bad. Everything else
 * must surface as INTERNAL, with its real message in the log.
 */

function pdfParseThrowing(error: unknown) {
  vi.doMock('pdf-parse', () => ({
    PDFParse: class {
      getText() { return Promise.reject(error); }
      destroy() { return Promise.resolve(); }
    },
  }));
}

async function extract() {
  vi.resetModules();
  const { extractPdfText, CorruptPdfError } = await import('@/lib/pdf/extract-text');
  return { run: () => extractPdfText(Buffer.from('%PDF-1.4 stub')), CorruptPdfError };
}

describe('extractPdfText — what counts as a corrupt file', () => {
  it('maps pdfjs InvalidPDFException to CorruptPdfError', async () => {
    // Exactly what pdfjs throws for a truncated file and for non-PDF bytes.
    pdfParseThrowing(Object.assign(new Error('Invalid PDF structure.'), { name: 'InvalidPDFException' }));
    const { run, CorruptPdfError } = await extract();
    await expect(run()).rejects.toBeInstanceOf(CorruptPdfError);
  });

  it('maps a password-protected document to CorruptPdfError', async () => {
    pdfParseThrowing(Object.assign(new Error('No password given'), { name: 'PasswordException' }));
    const { run, CorruptPdfError } = await extract();
    await expect(run()).rejects.toBeInstanceOf(CorruptPdfError);
  });

  it('does NOT blame the file for a missing runtime global', async () => {
    pdfParseThrowing(new ReferenceError('Path2D is not defined'));
    const { run, CorruptPdfError } = await extract();
    const err = await run().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ReferenceError);
    expect(err).not.toBeInstanceOf(CorruptPdfError);
  });

  it('does NOT blame the file for a bundle missing the worker or its assets', async () => {
    pdfParseThrowing(new Error('Setting up fake worker failed: "Cannot find module \'./pdf.worker.mjs\'".'));
    const { run, CorruptPdfError } = await extract();
    const err = await run().catch((e: unknown) => e);
    expect(err).not.toBeInstanceOf(CorruptPdfError);
    expect((err as Error).message).toContain('Setting up fake worker failed');
  });
});
