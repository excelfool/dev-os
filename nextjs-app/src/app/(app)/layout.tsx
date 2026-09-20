import { redirect } from 'next/navigation';
import { Navbar } from '@/components/layout/Navbar';
import { Footer } from '@/components/layout/Footer';
import { SystemStatusBanner } from '@/components/layout/SystemStatusBanner';
import { SessionStartRecorder } from '@/components/layout/SessionStartRecorder';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import type { Plan } from '@/types/domain';

/**
 * Authed shell (spec 03 §10). Re-reads the session as defence in depth behind
 * the middleware — layer 2 of 3.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect('/login');

  const { data: profile } = await supabase
    .from('profiles')
    .select('email, plan')
    .eq('id', user.id)
    .single();

  return (
    <div className="flex min-h-screen flex-col">
      <SystemStatusBanner />
      <Navbar email={profile?.email ?? user.email ?? ''} plan={(profile?.plan ?? 'free_trial') as Plan} />
      <SessionStartRecorder userId={user.id} />
      <div className="flex-1">{children}</div>
      <Footer />
    </div>
  );
}
