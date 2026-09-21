import { createServerSupabaseClient } from '@/lib/supabase/server';
import { appError } from '@/lib/errors/app-error';
import { withErrorHandling } from '@/lib/errors/to-user-message';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/system-status (spec 12 row 18, spec 14 §2).
 *
 * Auth is required — `system_status` grants SELECT to `authenticated` only.
 * The route is excluded from the middleware matcher purely to skip a cookie
 * refresh on the 60-second poll, so the handler re-checks the session itself
 * and returns 401 to an anonymous caller.
 */
export async function GET(request: Request) {
  return withErrorHandling({ route: '/api/system-status', method: 'GET' }, async (ctx) => {
    const supabase = createServerSupabaseClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) throw appError('UNAUTHENTICATED');
    ctx.userId = user.id;

    const { data, error } = await supabase
      .from('system_status')
      .select('level, message')
      .single();

    if (error) throw appError('INTERNAL');

    return new Response(JSON.stringify({ level: data.level, message: data.message }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    });
  });
}
