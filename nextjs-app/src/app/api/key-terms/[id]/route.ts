import { createServerSupabaseClient } from '@/lib/supabase/server';
import { appError } from '@/lib/errors/app-error';
import { withErrorHandling } from '@/lib/errors/to-user-message';
import { keyTermUpdateSchema } from '@/lib/validation/key-term.schema';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * PATCH /api/key-terms/{id} (spec 07 §5).
 *
 * `original_ai_value` is NEVER modified — it was captured at insert and is what
 * makes the correction-rate metric meaningful.
 */
export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  return withErrorHandling({ route: '/api/key-terms/[id]', method: 'PATCH' }, async () => {
    const supabase = createServerSupabaseClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) throw appError('UNAUTHENTICATED');

    let value: string;
    try {
      ({ value } = keyTermUpdateSchema.parse(await request.json()));
    } catch {
      throw appError('INVALID_VALUE');
    }

    const { data: updated, error } = await supabase
      .from('key_terms')
      .update({ value, is_edited: true, edited_at: new Date().toISOString() })
      .eq('id', params.id)
      .eq('user_id', user.id)
      .select('id, value, is_edited, original_ai_value, edited_at')
      .maybeSingle();

    if (error) throw appError('INTERNAL');
    // Another user's term id is indistinguishable from a missing one.
    if (!updated) throw appError('NOT_FOUND', { noun: 'key term' });

    return Response.json(updated);
  });
}
