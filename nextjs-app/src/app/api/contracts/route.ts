import { createServerSupabaseClient } from '@/lib/supabase/server';
import { appError } from '@/lib/errors/app-error';
import { withErrorHandling } from '@/lib/errors/to-user-message';
import { contractsQuerySchema } from '@/lib/validation/contracts-query.schema';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/contracts (spec 09 §3).
 *
 * Sort columns pass through the zod enum before reaching the query builder —
 * the client string is never interpolated (spec 13 §7).
 */
export async function GET(request: Request) {
  return withErrorHandling({ route: '/api/contracts', method: 'GET' }, async (ctx) => {
    const supabase = createServerSupabaseClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) throw appError('UNAUTHENTICATED');
    ctx.userId = user.id;

    const url = new URL(request.url);
    const query = contractsQuerySchema.parse(Object.fromEntries(url.searchParams));

    let rows = supabase
      .from('contracts')
      .select('id, file_name, contract_type, status, page_count, created_at, review_completed_at', {
        count: 'exact',
      })
      .eq('user_id', user.id);

    if (query.type) rows = rows.eq('contract_type', query.type);
    if (query.status) rows = rows.eq('status', query.status);

    const from = (query.page - 1) * query.page_size;
    const { data, count, error } = await rows
      .order(query.sort, { ascending: query.order === 'asc' })
      .range(from, from + query.page_size - 1);

    if (error) throw appError('INTERNAL');

    // Summary counts are unfiltered — they describe the account, not the view.
    const [total, nda, msa] = await Promise.all([
      supabase.from('contracts').select('id', { count: 'exact', head: true }),
      supabase.from('contracts').select('id', { count: 'exact', head: true }).eq('contract_type', 'NDA'),
      supabase.from('contracts').select('id', { count: 'exact', head: true }).eq('contract_type', 'MSA'),
    ]);

    return Response.json({
      contracts: data ?? [],
      page: query.page,
      page_size: query.page_size,
      total: count ?? 0,
      summary: { total: total.count ?? 0, nda: nda.count ?? 0, msa: msa.count ?? 0 },
    });
  });
}
