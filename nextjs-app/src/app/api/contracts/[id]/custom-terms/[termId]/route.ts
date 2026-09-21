import { createServerSupabaseClient } from '@/lib/supabase/server';
import { appError, appErrorWithMessage } from '@/lib/errors/app-error';
import { ERROR_DEFINITIONS, ALREADY_PROCESSED_CUSTOM_TERMS_SUFFIX } from '@/lib/errors/error-codes';
import { withErrorHandling } from '@/lib/errors/to-user-message';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function DELETE(
  _request: Request,
  { params }: { params: { id: string; termId: string } },
) {
  return withErrorHandling(
    { route: '/api/contracts/[id]/custom-terms/[termId]', method: 'DELETE' },
    async (ctx) => {
      const supabase = createServerSupabaseClient();

      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw appError('UNAUTHENTICATED');
    ctx.userId = user.id;

      const { data: contract } = await supabase
        .from('contracts')
        .select('id, status')
        .eq('id', params.id)
        .eq('user_id', user.id)
        .single();
      if (!contract) throw appError('NOT_FOUND');

      if (contract.status !== 'uploaded' && contract.status !== 'error') {
        throw appErrorWithMessage(
          'ALREADY_PROCESSED',
          ERROR_DEFINITIONS.ALREADY_PROCESSED.message + ALREADY_PROCESSED_CUSTOM_TERMS_SUFFIX,
        );
      }

      const { data: deleted } = await supabase
        .from('custom_key_terms')
        .delete()
        .eq('id', params.termId)
        .eq('contract_id', contract.id)
        .eq('user_id', user.id)
        .select('id');

      // 404 when the term id does not belong to this contract.
      if (!deleted || deleted.length === 0) throw appError('NOT_FOUND', { noun: 'custom term' });

      return new Response(null, { status: 204 });
    },
  );
}
