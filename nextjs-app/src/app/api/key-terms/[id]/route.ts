import { createServerSupabaseClient } from '@/lib/supabase/server';
import { appError } from '@/lib/errors/app-error';
import { withErrorHandling } from '@/lib/errors/to-user-message';
import { keyTermUpdateSchema } from '@/lib/validation/key-term.schema';
import { KEY_DATE_SOURCE_TERMS, deriveKeyDatesBounded } from '@/lib/services/reminder-service';
import type { ContractType } from '@/types/domain';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * PATCH /api/key-terms/{id} (spec 07 §5).
 *
 * `original_ai_value` is NEVER modified — it was captured at insert and is what
 * makes the correction-rate metric meaningful.
 */
export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  return withErrorHandling({ route: '/api/key-terms/[id]', method: 'PATCH' }, async (ctx) => {
    const supabase = createServerSupabaseClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) throw appError('UNAUTHENTICATED');
    ctx.userId = user.id;

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
      .select('id, value, is_edited, original_ai_value, edited_at, term_name, contract_id')
      .maybeSingle();

    if (error) throw appError('INTERNAL');
    // Another user's term id is indistinguishable from a missing one.
    if (!updated) throw appError('NOT_FOUND', { noun: 'key term' });

    // Spec 21 §7.2: editing a reminder-source term re-derives its key date.
    const { data: contract } = await supabase
      .from('contracts')
      .select('contract_type')
      .eq('id', updated.contract_id)
      .single();
    const type = (contract?.contract_type ?? 'NDA') as ContractType;
    if (KEY_DATE_SOURCE_TERMS[type].includes(updated.term_name as string)) {
      await deriveKeyDatesBounded(supabase, updated.contract_id as string, user.id, type);
    }

    const { term_name: _t, contract_id: _c, ...body } = updated;
    return Response.json(body);
  });
}
