import { describe, expect, it } from 'vitest';
import { getDocxExtractor } from '@/lib/integrations/docx';
import { NullDocxExtractor } from '@/lib/integrations/docx/null-adapter';
import { getOcrAdapter } from '@/lib/integrations/ocr';
import { NullOcrAdapter } from '@/lib/integrations/ocr/null-adapter';

/** Spec 21 §9 — every NullAdapter returns NOT_CONFIGURED with its key and never throws. */

describe('null adapters', () => {
  it('docx: NOT_CONFIGURED with capability ingest.docx', async () => {
    const result = await getDocxExtractor().extract(Buffer.from('PK\x03\x04'));
    expect(result).toEqual({ ok: false, reason: 'NOT_CONFIGURED', capability: 'ingest.docx' });
  });

  it('ocr: NOT_CONFIGURED with capability ingest.ocr', async () => {
    const result = await getOcrAdapter().extract(Buffer.from('%PDF-1.4'));
    expect(result).toEqual({ ok: false, reason: 'NOT_CONFIGURED', capability: 'ingest.ocr' });
  });

  it('the getters return the NullAdapter when no provider is configured', () => {
    expect(getDocxExtractor()).toBeInstanceOf(NullDocxExtractor);
    expect(getOcrAdapter()).toBeInstanceOf(NullOcrAdapter);
  });

  it('never throws on empty input', async () => {
    await expect(getDocxExtractor().extract(Buffer.alloc(0))).resolves.toMatchObject({ ok: false });
    await expect(getOcrAdapter().extract(Buffer.alloc(0))).resolves.toMatchObject({ ok: false });
  });
});
