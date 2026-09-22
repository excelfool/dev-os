import { z } from 'zod';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { appError } from '@/lib/errors/app-error';
import { withErrorHandling } from '@/lib/errors/to-user-message';
import { replaceReminders } from '@/lib/services/reminder-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  offsets_days: z.array(z.union([z.literal(30), z.literal(60), z.literal(90)])).max(3),
});

/** PATCH /api/key-dates/{id}/reminders (route 30, spec 21 §5) — replaces the scheduled reminders. */
export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  return withErrorHandling({ route: '/api/key-dates/[id]/reminders', method: 'PATCH' }, async (ctx) => {
    const supabase = createServerSupabaseClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) throw appError('UNAUTHENTICATED');
    ctx.userId = user.id;

    let offsets: number[];
    try {
      offsets = [...new Set(bodySchema.parse(await request.json()).offsets_days)];
    } catch {
      throw appError('INVALID_OFFSETS');
    }

    const { data: keyDate } = await supabase
      .from('key_dates')
      .select('id, date')
      .eq('id', params.id)
      .eq('user_id', user.id)
      .maybeSingle();
    if (!keyDate) throw appError('NOT_FOUND', { noun: 'key date' });

    const [y, m, d] = String(keyDate.date).split('-').map(Number);
    await replaceReminders(supabase, keyDate.id, user.id, new Date(Date.UTC(y!, m! - 1, d!)), offsets);

    const { data: reminders } = await supabase
      .from('reminders')
      .select('id, offset_days, send_at, status, channel')
      .eq('key_date_id', keyDate.id)
      .order('offset_days', { ascending: true });
    return Response.json({ key_date_id: keyDate.id, reminders: reminders ?? [] });
  });
}
