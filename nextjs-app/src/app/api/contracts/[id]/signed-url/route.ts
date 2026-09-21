import { createServerSupabaseClient } from '@/lib/supabase/server';
import { appError } from '@/lib/errors/app-error';
import { withErrorHandling } from '@/lib/errors/to-user-message';
import { getServerConfig } from '@/lib/utils/server-config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** POST /api/contracts/{id}/signed-url (spec 07 §6). 1-hour TTL only. */
export async function POST(_request: Request, { params }: { params: { id: string } }) {
  return withErrorHandling(
    { route: '/api/contracts/[id]/signed-url', method: 'POST' },
    async (ctx) => {
      const cfg = getServerConfig();
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

      if (!contract) throw appError('NOT_FOUND');
      // The client falls back to the text viewer silently on this code.
      if (!contract.file_path) throw appError('NO_FILE');

      const { data, error } = await supabase.storage
        .from('contracts')
        .createSignedUrl(contract.file_path, cfg.SIGNED_URL_TTL_SECONDS);

      if (error || !data) throw appError('NO_FILE');

      return Response.json({ url: data.signedUrl, expires_in: cfg.SIGNED_URL_TTL_SECONDS });
    },
  );
}
