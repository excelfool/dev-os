import { createServerSupabaseClient } from '@/lib/supabase/server';
import { appError, AppError } from '@/lib/errors/app-error';
import { withErrorHandling } from '@/lib/errors/to-user-message';
import { enforceRateLimit } from '@/lib/security/rate-limit';
import { withAnalysisSlot } from '@/lib/security/concurrency';
import { persistPipelineFailure, runProcessingPipeline } from '@/lib/services/process-pipeline';
import { enqueueProcessJob, isAsyncPipelineEnabled } from '@/lib/services/process-job';
import { recordEvent } from '@/lib/metrics/events';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * The handler's own total deadline (spec 06 §3a). The Netlify Pro function
 * ceiling is 26s, while 3 × 20s attempts plus a repair retry would exceed it,
 * so the run is stopped at 24s and persisted as a retryable error instead of
 * being killed mid-flight.
 */
const REQUEST_DEADLINE_MS = 24_000;
const STALE_PROCESSING_MS = 5 * 60 * 1000;

/**
 * POST /api/contracts/{id}/process (spec 06 §3; v1.1 §G, D49 a).
 *
 * Every guard runs here regardless of mode: auth, ownership, status, rate
 * limit, the global semaphore and the `processing` claim. Then:
 *
 * - `pipeline.async` (PROCESS_JOB_SECRET set): the signed job is handed to
 *   the Netlify background function and the route returns
 *   `202 { status: 'processing' }`. The results page polls GET every 2 s.
 * - otherwise (local dev, tests): the pipeline runs inline under the 24 s
 *   deadline and the route returns 200 with the terms, exactly as before.
 */
export async function POST(_request: Request, { params }: { params: { id: string } }) {
  return withErrorHandling(
    { route: '/api/contracts/[id]/process', method: 'POST' },
    async (ctx) => {
      const supabase = createServerSupabaseClient();
      const requestStartedAt = Date.now();
      const deadlineAt = requestStartedAt + REQUEST_DEADLINE_MS;

      // 1. Session + ownership
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw appError('UNAUTHENTICATED');
      ctx.userId = user.id;

      const { data: contract } = await supabase
        .from('contracts')
        .select(
          'id, user_id, contract_type, contract_text, page_count, status, processing_started_at, ocr_confidence',
        )
        .eq('id', params.id)
        .eq('user_id', user.id)
        .single();

      if (!contract) throw appError('NOT_FOUND');

      // 2. Status guard
      if (contract.status === 'completed') throw appError('ALREADY_PROCESSED');
      if (contract.status === 'processing') {
        const startedAt = contract.processing_started_at
          ? new Date(contract.processing_started_at).getTime()
          : 0;
        // A run older than 5 minutes is stale and is re-claimed rather than
        // rejected — otherwise a killed function strands the contract forever.
        if (Date.now() - startedAt < STALE_PROCESSING_MS) throw appError('ALREADY_PROCESSING');
      }

      // 3. Rate limit
      await enforceRateLimit(user.id, 'process');

      // 4. Concurrency slot — always released in finally, inside withAnalysisSlot.
      //    In async mode the slot covers the claim and hand-off only; the
      //    background function takes its own slot for the run itself.
      return withAnalysisSlot(async () => {
        // 5. Claim the contract. processing_started_at — not updated_at — is
        //    what both staleness rules key on.
        await supabase
          .from('contracts')
          .update({ status: 'processing', processing_started_at: new Date().toISOString() })
          .eq('id', contract.id)
          .eq('user_id', user.id);

        await recordEvent(supabase, {
          userId: user.id,
          contractId: contract.id,
          eventType: 'process_started',
        });

        // 5a. pipeline.async — hand the run to the background function.
        if (isAsyncPipelineEnabled()) {
          try {
            await enqueueProcessJob(contract.id, user.id);
          } catch (err) {
            // Not queued: release the claim as a retryable error so "Try
            // again" works, rather than leaving the row to the 5-min reclaim.
            const appErr = err instanceof AppError ? err : appError('INTERNAL');
            await persistPipelineFailure(supabase, contract.id, user.id, appErr, Date.now() - requestStartedAt);
            throw appErr;
          }
          await recordEvent(supabase, {
            userId: user.id,
            contractId: contract.id,
            eventType: 'process_enqueued',
            durationMs: Date.now() - requestStartedAt,
          });
          return Response.json({ contract_id: contract.id, status: 'processing' }, { status: 202 });
        }

        // 6–12. Synchronous fallback: the pipeline inline under the 24 s deadline.
        const result = await runProcessingPipeline({
          supabase,
          contract: {
            id: contract.id,
            user_id: contract.user_id,
            contract_type: contract.contract_type,
            contract_text: contract.contract_text,
            page_count: contract.page_count,
            ocr_confidence: typeof contract.ocr_confidence === 'number' ? contract.ocr_confidence : null,
          },
          userId: user.id,
          deadlineAt,
          startedAt: requestStartedAt,
        });
        return Response.json(result);
      });
    },
  );
}
