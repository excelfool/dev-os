'use server';

import { revalidatePath } from 'next/cache';
import { createServerSupabaseClient } from '@/lib/supabase/server';

/**
 * Toggles `profiles.feedback_opt_in` (spec 03 §11). RLS restricts the update to
 * the caller's own row; the user id comes from the session, never the payload.
 */
export async function setFeedbackOptIn(optIn: boolean): Promise<{ ok: boolean }> {
  const supabase = createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false };

  const { error } = await supabase
    .from('profiles')
    .update({ feedback_opt_in: optIn })
    .eq('id', user.id);

  if (error) return { ok: false };

  revalidatePath('/settings');
  return { ok: true };
}
