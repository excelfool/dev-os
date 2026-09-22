import { createServerSupabaseClient } from '@/lib/supabase/server';
import { appError } from '@/lib/errors/app-error';
import { withErrorHandling } from '@/lib/errors/to-user-message';
import { enforceRateLimit } from '@/lib/security/rate-limit';
import { claimSummaryDeferred, runSummary } from '@/lib/services/summary-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/contracts/{id}/summary (route 34, spec 06 v1.1 §B / spec 12 v1.1).
 * Serves the deferred `pending` case, the `error` retry, legacy `none`
 * contracts, and a `processing` claim older than 2 minutes. Idempotent: a
 * claim held by another path returns 409 SUMMARY_NOT_PENDING.
 */
export async function POST(_request: Request, { params }: { params: { id: string } }) {
  return withErrorHandling({ route: '/api/contracts/[id]/summary', method: 'POST' }, async (ctx) => {
    const supabase = createServerSupabaseClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) throw appError('UNAUTHENTICATED');
    ctx.userId = user.id;

    await enforceRateLimit(user.id, 'process');

    const { data: contract } = await supabase
      .from('contracts')
      .select('id, user_id, status, contract_text, page_count')
      .eq('id', params.id)
      .eq('user_id', user.id)
      .single();
    if (!contract) throw appError('NOT_FOUND');
    // A summary is only ever generated over persisted terms.
    if (contract.status !== 'completed') throw appError('NOT_PROCESSED');

    const claimed = await claimSummaryDeferred(supabase, contract.id, user.id);
    if (!claimed) throw appError('SUMMARY_NOT_PENDING');

    const { data: terms } = await supabase
      .from('key_terms')
      .select('term_name, value, page_number, source_sentence')
      .eq('contract_id', contract.id)
      .order('display_rank', { ascending: true });

    const result = await runSummary(
      supabase,
      { id: contract.id, user_id: user.id, contract_text: contract.contract_text, page_count: contract.page_count },
      (terms ?? []) as Array<{ term_name: string; value: string | null; page_number: number | null; source_sentence: string | null }>,
    );

    return Response.json({ summary_md: result.summary_md, summary_status: result.summary_status, summary_uncited: result.summary_uncited });
  });
}
