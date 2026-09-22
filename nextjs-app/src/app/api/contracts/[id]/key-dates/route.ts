import { createServerSupabaseClient } from '@/lib/supabase/server';
import { appError } from '@/lib/errors/app-error';
import { withErrorHandling } from '@/lib/errors/to-user-message';
import { listKeyDates } from '@/lib/services/key-dates-query';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/contracts/{id}/key-dates (route 29, spec 21 §5) — live while the stub. */
export async function GET(_request: Request, { params }: { params: { id: string } }) {
  return withErrorHandling({ route: '/api/contracts/[id]/key-dates', method: 'GET' }, async (ctx) => {
    const supabase = createServerSupabaseClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) throw appError('UNAUTHENTICATED');
    ctx.userId = user.id;

    const { data: contract } = await supabase
      .from('contracts')
      .select('id')
      .eq('id', params.id)
      .eq('user_id', user.id)
      .single();
    if (!contract) throw appError('NOT_FOUND');

    return Response.json({ key_dates: await listKeyDates(supabase, contract.id) });
  });
}
