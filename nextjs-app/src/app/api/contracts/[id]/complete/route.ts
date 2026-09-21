import { createServerSupabaseClient } from '@/lib/supabase/server';
import { appError } from '@/lib/errors/app-error';
import { withErrorHandling } from '@/lib/errors/to-user-message';
import { recordEvent } from '@/lib/metrics/events';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/contracts/{id}/complete (spec 10 §1) — closes the North Star timer.
 * Idempotent: a second call leaves the first timestamp unchanged.
 */
export async function POST(_request: Request, { params }: { params: { id: string } }) {
  return withErrorHandling(
    { route: '/api/contracts/[id]/complete', method: 'POST' },
    async (ctx) => {
      const supabase = createServerSupabaseClient();

      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw appError('UNAUTHENTICATED');
    ctx.userId = user.id;

      const { data: contract } = await supabase
        .from('contracts')
        .select('id, created_at, review_completed_at')
        .eq('id', params.id)
        .eq('user_id', user.id)
        .single();
      if (!contract) throw appError('NOT_FOUND');

      // Normalised to ISO-8601 with `Z` either way: Postgres serialises
      // timestamptz as "+00:00" while a freshly generated value uses "Z", and
      // a client comparing the two responses as strings would see a mismatch
      // on an idempotent call.
      if (contract.review_completed_at) {
        return Response.json({
          review_completed_at: new Date(contract.review_completed_at).toISOString(),
        });
      }

      const completedAt = new Date().toISOString();
      const { error } = await supabase
        .from('contracts')
        .update({ review_completed_at: completedAt })
        .eq('id', contract.id)
        .eq('user_id', user.id);
      if (error) throw appError('INTERNAL');

      await recordEvent(supabase, {
        userId: user.id,
        contractId: contract.id,
        eventType: 'review_completed',
        durationMs: Date.now() - new Date(contract.created_at).getTime(),
      });

      return Response.json({ review_completed_at: completedAt });
    },
  );
}
