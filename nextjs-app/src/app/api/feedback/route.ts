import { createServerSupabaseClient } from '@/lib/supabase/server';
import { appError } from '@/lib/errors/app-error';
import { withErrorHandling } from '@/lib/errors/to-user-message';
import { feedbackSchema } from '@/lib/validation/feedback.schema';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/feedback (spec 10 §2). Fully autonomous logger — no AI, no
 * moderation, no side effects beyond the row.
 */
export async function POST(request: Request) {
  return withErrorHandling({ route: '/api/feedback', method: 'POST' }, async (ctx) => {
    const supabase = createServerSupabaseClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) throw appError('UNAUTHENTICATED');
    ctx.userId = user.id;

    const input = feedbackSchema.parse(await request.json());

    const { data: contract } = await supabase
      .from('contracts')
      .select('id, contract_type')
      .eq('id', input.contract_id)
      .eq('user_id', user.id)
      .single();
    if (!contract) throw appError('NOT_FOUND');

    // One rating per (user, contract), updatable. contract_type is
    // denormalised so feedback can be segmented by type without a join.
    const { data, error } = await supabase
      .from('user_feedback')
      .upsert(
        {
          user_id: user.id,
          contract_id: contract.id,
          rating: input.rating,
          comment: input.comment ?? null,
          survey_accuracy: input.survey_accuracy ?? null,
          contract_type: contract.contract_type,
        },
        { onConflict: 'user_id,contract_id' },
      )
      .select('*')
      .single();

    if (error) throw appError('INTERNAL');

    return Response.json(data, { status: 201 });
  });
}
