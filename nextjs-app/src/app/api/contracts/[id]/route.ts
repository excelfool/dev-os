import { createServerSupabaseClient } from '@/lib/supabase/server';
import { appError } from '@/lib/errors/app-error';
import { withErrorHandling } from '@/lib/errors/to-user-message';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/contracts/{id} (spec 12 row 6).
 *
 * Touches `last_accessed_at` — the 90-day retention anchor (A-10). This is also
 * the 2-second poll used by the results page while a contract is processing,
 * which is exactly why staleness keys off `processing_started_at` and not
 * `updated_at` (spec 06 §3a).
 */
export async function GET(_request: Request, { params }: { params: { id: string } }) {
  return withErrorHandling({ route: '/api/contracts/[id]', method: 'GET' }, async (ctx) => {
    const supabase = createServerSupabaseClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) throw appError('UNAUTHENTICATED');
    ctx.userId = user.id;

    const { data: contract } = await supabase
      .from('contracts')
      .select('*')
      .eq('id', params.id)
      .eq('user_id', user.id)
      .single();

    if (!contract) throw appError('NOT_FOUND');

    await supabase
      .from('contracts')
      .update({ last_accessed_at: new Date().toISOString() })
      .eq('id', contract.id)
      .eq('user_id', user.id);

    const [{ data: keyTerms }, { data: customTerms }] = await Promise.all([
      supabase
        .from('key_terms')
        .select('*')
        .eq('contract_id', contract.id)
        .order('display_rank', { ascending: true })
        .order('term_name', { ascending: true }),
      supabase
        .from('custom_key_terms')
        .select('id, term_name, is_manual, created_at')
        .eq('contract_id', contract.id),
    ]);

    return Response.json({
      contract: {
        ...contract,
        storage_available: contract.file_path !== null,
      },
      key_terms: keyTerms ?? [],
      custom_terms: customTerms ?? [],
    });
  });
}

/**
 * DELETE /api/contracts/{id} (spec 11 §1).
 *
 * A Storage failure here is logged and ignored — it must not block the DB
 * deletion, and the nightly job sweeps orphans.
 */
export async function DELETE(_request: Request, { params }: { params: { id: string } }) {
  return withErrorHandling({ route: '/api/contracts/[id]', method: 'DELETE' }, async (ctx) => {
    const supabase = createServerSupabaseClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) throw appError('UNAUTHENTICATED');
    ctx.userId = user.id;

    const { data: contract } = await supabase
      .from('contracts')
      .select('id, file_path')
      .eq('id', params.id)
      .eq('user_id', user.id)
      .single();

    // Another user's id is indistinguishable from a missing one — never
    // disclose existence.
    if (!contract) throw appError('NOT_FOUND');

    if (contract.file_path) {
      const { error } = await supabase.storage.from('contracts').remove([contract.file_path]);
      if (error) {
        console.warn(
          JSON.stringify({ storage: 'delete_failed', contractId: contract.id, reason: error.message }),
        );
      }
    }

    const { error: deleteError } = await supabase
      .from('contracts')
      .delete()
      .eq('id', contract.id)
      .eq('user_id', user.id);

    if (deleteError) throw appError('INTERNAL');

    // ON DELETE CASCADE removes key_terms, custom_key_terms, chat_sessions,
    // chat_messages, user_feedback, processing_runs and openai_calls.
    return new Response(null, { status: 204 });
  });
}
