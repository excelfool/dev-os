'use client';

import { useEffect, useMemo } from 'react';
import { createBrowserSupabaseClient } from '@/lib/supabase/client';
import { recordEvent } from '@/lib/metrics/events';

const SESSION_FLAG = 'contractiq:session_started';

/**
 * `session_start` is recorded once per browser session on the first authed page
 * load (spec 03 §12). It is the input to the 30-day retention cohort query.
 */
export function SessionStartRecorder({ userId }: { userId: string }) {
  const supabase = useMemo(() => createBrowserSupabaseClient(), []);

  useEffect(() => {
    if (sessionStorage.getItem(SESSION_FLAG)) return;
    sessionStorage.setItem(SESSION_FLAG, '1');
    void recordEvent(supabase, { userId, eventType: 'session_start' });
  }, [supabase, userId]);

  return null;
}
