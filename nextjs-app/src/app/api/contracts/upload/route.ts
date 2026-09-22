import { createServerSupabaseClient } from '@/lib/supabase/server';
import { appError } from '@/lib/errors/app-error';
import { withErrorHandling } from '@/lib/errors/to-user-message';
import { enforceRateLimit } from '@/lib/security/rate-limit';
import { assertQuota, consumeQuotaUnit, refundQuotaUnit, planLabel } from '@/lib/security/quota';
import { uploadSchema } from '@/lib/validation/upload.schema';
import { extractPdfText, CorruptPdfError } from '@/lib/pdf/extract-text';
import { estimateTokens } from '@/lib/pdf/page-utils';
import { getServerConfig } from '@/lib/utils/server-config';
import { formatMegabytes, sanitiseFilename } from '@/lib/utils/format';
import { recordProcessingRun } from '@/lib/metrics/timings';
import { recordEvent } from '@/lib/metrics/events';
import { getDocxExtractor } from '@/lib/integrations/docx';
import { getOcrAdapter } from '@/lib/integrations/ocr';
import { createHash } from 'node:crypto';

// pdf-parse requires the Node runtime.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const PDF_MAGIC = '%PDF-';
// A .docx is a ZIP container: local-file-header signature PK\x03\x04.
const ZIP_MAGIC = 'PK\x03\x04';
const OCR_MIN_CONFIDENCE = 80;

/**
 * POST /api/contracts/upload — the authoritative gate (spec 04 §2).
 *
 * Steps run in exact order; each short-circuits with its own error code and
 * nothing is written to the DB until step 8. A Storage failure never fails the
 * request.
 */
export async function POST(request: Request) {
  return withErrorHandling({ route: '/api/contracts/upload', method: 'POST' }, async (ctx) => {
    const cfg = getServerConfig();
    const supabase = createServerSupabaseClient();
    const requestStartedAt = Date.now();

    // 1. Session
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) throw appError('UNAUTHENTICATED');
    ctx.userId = user.id;

    // 2. Rate limit
    await enforceRateLimit(user.id, 'upload');

    // 3. Quota pre-check (read-only; the unit is consumed at step 7b)
    const quota = await assertQuota(supabase, user.id);

    // 4. Schema
    const form = await request.formData();
    const { contract_type: contractType } = uploadSchema.parse({
      contract_type: form.get('contract_type'),
    });

    // 5. File presence and size
    const file = form.get('file');
    if (!(file instanceof File) || file.size === 0) throw appError('NOT_A_PDF');
    if (file.size > cfg.MAX_UPLOAD_MB * 1024 * 1024) {
      throw appError('FILE_TOO_LARGE', { size: formatMegabytes(file.size) });
    }

    const buffer = Buffer.from(await file.arrayBuffer());

    // 6. Magic bytes — the declared MIME type is not trusted.
    // v1.1 (spec 04 §B, spec 21 §4.1): PK\x03\x04 AND a .docx name → the DOCX
    // extractor; NOT_CONFIGURED ⇒ 422 UNSUPPORTED_FORMAT, nothing stored.
    // Any other non-%PDF- file ⇒ 400 NOT_A_PDF as before.
    if (buffer.subarray(0, 5).toString('latin1') !== PDF_MAGIC) {
      const isDocx =
        buffer.subarray(0, 4).toString('latin1') === ZIP_MAGIC && /\.docx$/i.test(file.name);
      if (isDocx) {
        const docx = await getDocxExtractor().extract(buffer);
        if (!docx.ok) throw appError('UNSUPPORTED_FORMAT');
        // No extractor is wired today (spec 21 §4). When one is, its
        // [PAGE N]-marked text feeds step 7 exactly like a parsed PDF.
        throw appError('UNSUPPORTED_FORMAT');
      }
      throw appError('NOT_A_PDF');
    }

    // D46: content hash of the raw bytes, stored at step 8 and used for the
    // non-blocking duplicate notice.
    const contentHash = createHash('sha256').update(buffer).digest('hex');

    await recordEvent(supabase, {
      userId: user.id,
      eventType: 'upload_start',
      metadata: { contract_type: contractType },
    });

    // 7. Parse and validate the document
    const extractStartedAt = Date.now();
    let extracted;
    try {
      extracted = await extractPdfText(buffer);
    } catch (err) {
      // Nothing stored — "corrupted PDF → graceful error, no partial output".
      if (err instanceof CorruptPdfError) throw appError('CORRUPT_PDF');
      throw err;
    }
    const textExtractMs = Date.now() - extractStartedAt;

    // Pages and tokens are independent hard gates, checked in this order.
    if (extracted.pageCount > cfg.MAX_PAGES) {
      throw appError('TOO_MANY_PAGES', { pages: extracted.pageCount });
    }
    // v1.1 scanned branch (spec 04 §B): below the word floor, try OCR.
    // NOT_CONFIGURED ⇒ the existing 422 SCANNED_PDF. Configured: OCR text
    // replaces the parse result; confidence < 80 ⇒ 422 OCR_LOW_CONFIDENCE.
    let ocrConfidence: number | null = null;
    if (extracted.wordCount < cfg.MIN_TEXT_WORDS) {
      const ocr = await getOcrAdapter().extract(buffer);
      if (!ocr.ok) throw appError('SCANNED_PDF');
      if (ocr.value.confidence < OCR_MIN_CONFIDENCE) {
        throw appError('OCR_LOW_CONFIDENCE', { n: Math.round(ocr.value.confidence) });
      }
      ocrConfidence = ocr.value.confidence;
      extracted = {
        ...extracted,
        text: ocr.value.text,
        pageCount: ocr.value.pageCount,
        wordCount: ocr.value.text.split(/\s+/).filter(Boolean).length,
      };
      if (extracted.wordCount < cfg.MIN_TEXT_WORDS) throw appError('SCANNED_PDF');
    }

    const tokenEstimate = estimateTokens(extracted.text);
    if (tokenEstimate > cfg.MAX_TOKENS) throw appError('TOO_MANY_TOKENS');

    // 7b. Consume the quota unit
    const used = await consumeQuotaUnit(user.id, quota.periodStart);
    if (quota.limit !== null && used > quota.limit) {
      await refundQuotaUnit(user.id);
      throw appError('QUOTA_EXCEEDED', { limit: quota.limit, plan: planLabel(quota.plan) });
    }

    // Everything after this point refunds the unit on failure — a user is never
    // charged for a contract that does not exist.
    let contractId: string;
    let duplicateOf: { id: string; created_at: string } | null = null;
    try {
      // D46: an earlier upload of the same bytes by this user is reported,
      // never rejected.
      const { data: existing } = await supabase
        .from('contracts')
        .select('id, created_at')
        .eq('user_id', user.id)
        .eq('content_hash', contentHash)
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle();
      if (existing) duplicateOf = { id: existing.id, created_at: existing.created_at };

      // 8. Insert
      const { data: inserted, error: insertError } = await supabase
        .from('contracts')
        .insert({
          user_id: user.id,
          file_name: file.name,
          contract_type: contractType,
          file_size_bytes: file.size,
          page_count: extracted.pageCount,
          token_estimate: tokenEstimate,
          contract_text: extracted.text,
          file_path: null,
          status: 'uploaded',
          last_accessed_at: new Date().toISOString(),
          prompt_version: cfg.PROMPT_VERSION,
          content_hash: contentHash,
          ocr_confidence: ocrConfidence,
        })
        .select('id')
        .single();

      if (insertError || !inserted) throw appError('INTERNAL');
      contractId = inserted.id;
    } catch (err) {
      await refundQuotaUnit(user.id);
      throw err;
    }

    // 9. Storage — non-blocking, best effort. The AI pipeline never depends on it.
    let storageAvailable = false;
    const objectPath = `${user.id}/${contractId}/${sanitiseFilename(file.name)}`;
    const { error: storageError } = await supabase.storage
      .from('contracts')
      .upload(objectPath, buffer, { contentType: 'application/pdf', upsert: false });

    if (storageError) {
      console.warn(
        JSON.stringify({ storage: 'upload_failed', contractId, reason: storageError.message }),
      );
    } else {
      const { error: pathError } = await supabase
        .from('contracts')
        .update({ file_path: objectPath })
        .eq('id', contractId)
        .eq('user_id', user.id);
      storageAvailable = !pathError;
    }

    // 10. Telemetry
    await Promise.all([
      recordProcessingRun(supabase, {
        contractId,
        userId: user.id,
        stage: 'text_extract',
        durationMs: textExtractMs,
        outcome: 'success',
      }),
      recordProcessingRun(supabase, {
        contractId,
        userId: user.id,
        stage: 'upload',
        durationMs: Date.now() - requestStartedAt,
        outcome: 'success',
      }),
      recordEvent(supabase, {
        userId: user.id,
        contractId,
        eventType: 'upload_complete',
        durationMs: Date.now() - requestStartedAt,
        metadata: { contract_type: contractType, pages: extracted.pageCount },
      }),
    ]);

    return Response.json(
      {
        contract_id: contractId,
        page_count: extracted.pageCount,
        token_estimate: tokenEstimate,
        storage_available: storageAvailable,
        status: 'uploaded',
        ...(ocrConfidence !== null ? { ocr_confidence: ocrConfidence } : {}),
        ...(duplicateOf
          ? { duplicate_of: duplicateOf.id, duplicate_created_at: duplicateOf.created_at }
          : {}),
      },
      { status: 201 },
    );
  });
}
