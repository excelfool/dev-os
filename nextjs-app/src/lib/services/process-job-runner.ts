import 'server-only';
import { createAdminSupabaseClient } from '@/lib/supabase/admin';
import { withAnalysisSlot } from '@/lib/security/concurrency';
import { getServerConfig } from '@/lib/utils/server-config';
import { AppError, appError } from '@/lib/errors/app-error';
import { verifyProcessJob, PROCESS_JOB_SIGNATURE_HEADER } from '@/lib/security/process-job-signature';
import { persistPipelineFailure, runProcessingPipeline } from '@/lib/services/process-pipeline';

/**
 * The body of `netlify/functions/process-background.ts` (spec 06 v1.1 §G,
 * D49 a), kept here so the integration suite can drive it in-process against
 * the OpenAI stub. The Netlify file is a thin adapter around `runProcessJob`.
 *
 * Service-role client: the job carries no user session, only the route's
 * signature. Sanctioned call site (7) in spec 13 §2.
 */

export interface ProcessJobOutcome {
  status: number;
  body: Record<string, unknown>;
}

export async function runProcessJob(rawBody: string, signature: string | null): Promise<ProcessJobOutcome> {
  const cfg = getServerConfig();
  if (!cfg.PROCESS_JOB_SECRET) return { status: 503, body: { error: 'PROCESS_JOB_SECRET is not configured' } };

  const verified = verifyProcessJob(rawBody, signature, cfg.PROCESS_JOB_SECRET);
  if (!verified.ok) {
    console.warn(JSON.stringify({ process_job: 'rejected', reason: verified.reason }));
    return { status: 401, body: { error: verified.reason } };
  }
  const { contract_id: contractId, user_id: userId } = verified.payload;

  const supabase = createAdminSupabaseClient();
  const startedAt = Date.now();
  const deadlineAt = startedAt + cfg.PROCESS_JOB_BUDGET_MS;

  const { data: contract } = await supabase
    .from('contracts')
    .select('id, user_id, contract_type, contract_text, page_count, status, processing_started_at, ocr_confidence')
    .eq('id', contractId)
    .eq('user_id', userId)
    .single();

  // The route claimed the row before enqueueing; anything else means the
  // claim was lost (reclaimed, retried inline, deleted) and this job is stale.
  if (!contract) return { status: 404, body: { error: 'contract not found for user' } };
  if (contract.status !== 'processing') {
    return { status: 409, body: { error: `contract is ${contract.status}, not processing` } };
  }

  try {
    const result = await withAnalysisSlot(() =>
      runProcessingPipeline({
        supabase,
        contract: {
          id: contract.id,
          user_id: contract.user_id,
          contract_type: contract.contract_type,
          contract_text: contract.contract_text,
          page_count: contract.page_count,
          ocr_confidence: typeof contract.ocr_confidence === 'number' ? contract.ocr_confidence : null,
        },
        userId,
        deadlineAt,
        startedAt,
      }),
    );
    console.info(JSON.stringify({ process_job: 'completed', contractId, termCount: result.term_count, durationMs: Date.now() - startedAt }));
    return { status: 200, body: { contract_id: contractId, status: 'completed', term_count: result.term_count, summary_status: result.summary_status } };
  } catch (err) {
    // runProcessingPipeline persists its own failures; a throw from the
    // semaphore (CAPACITY) or anything else outside it is persisted here.
    const appErr = err instanceof AppError ? err : appError('INTERNAL');
    const { data: row } = await supabase.from('contracts').select('status').eq('id', contractId).single();
    if (row?.status === 'processing') {
      await persistPipelineFailure(supabase, contractId, userId, appErr, Date.now() - startedAt);
    }
    console.error(JSON.stringify({ process_job: 'failed', contractId, code: appErr.code }));
    return { status: 500, body: { contract_id: contractId, status: 'error', code: appErr.code } };
  }
}

export { PROCESS_JOB_SIGNATURE_HEADER };
