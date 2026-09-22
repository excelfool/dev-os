import { createServerSupabaseClient } from '@/lib/supabase/server';
import { appError } from '@/lib/errors/app-error';
import { withErrorHandling } from '@/lib/errors/to-user-message';
import { listCapabilities } from '@/lib/capabilities';
import { BUILD_COMMIT } from '@/generated/build-info';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Fixed at module load: the registry changes only with a deploy (spec 21 §2).
const GENERATED_AT = new Date().toISOString();

/**
 * GET /api/capabilities (spec 21 §2, route 26). Authenticated; no rate limit.
 * Returns the full registry sorted by key, including internal keys.
 */
export async function GET() {
  return withErrorHandling({ route: '/api/capabilities', method: 'GET' }, async (ctx) => {
    const supabase = createServerSupabaseClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) throw appError('UNAUTHENTICATED');
    ctx.userId = user.id;

    return Response.json(
      { generated_at: GENERATED_AT, commit: BUILD_COMMIT, capabilities: listCapabilities() },
      { headers: { 'Cache-Control': 'private, max-age=3600' } },
    );
  });
}
