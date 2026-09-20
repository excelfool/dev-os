import { createServerSupabaseClient } from '@/lib/supabase/server';
import { appError } from '@/lib/errors/app-error';
import { withErrorHandling } from '@/lib/errors/to-user-message';
import { npsSchema } from '@/lib/validation/nps.schema';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

/** POST /api/nps (spec 10 §3). At most one response per user per 30 days. */
export async function POST(request: Request) {
  return withErrorHandling({ route: '/api/nps', method: 'POST' }, async () => {
    const supabase = createServerSupabaseClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) throw appError('UNAUTHENTICATED');

    const input = npsSchema.parse(await request.json());

    const cutoff = new Date(Date.now() - THIRTY_DAYS_MS).toISOString();
    const { data: recent } = await supabase
      .from('nps_responses')
      .select('id')
      .eq('user_id', user.id)
      .gte('created_at', cutoff)
      .maybeSingle();

    if (recent) throw appError('ALREADY_SURVEYED');

    const { data, error } = await supabase
      .from('nps_responses')
      .insert({ user_id: user.id, score: input.score, comment: input.comment ?? null })
      .select('*')
      .single();

    if (error) throw appError('INTERNAL');

    return Response.json(data, { status: 201 });
  });
}
