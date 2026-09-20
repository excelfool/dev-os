import { redirect } from 'next/navigation';
import { Card, CardTitle } from '@/components/ui/card';
import { FeedbackOptInSwitch } from '@/components/layout/FeedbackOptInSwitch';
import { DangerZone } from '@/components/layout/DangerZone';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { getQuotaState, planLabel } from '@/lib/security/quota';
import { formatDate } from '@/lib/utils/format';
import type { Plan } from '@/types/domain';

export const metadata = { title: 'Settings · ContractIQ' };
export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  const supabase = createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: profile } = await supabase
    .from('profiles')
    .select('email, plan, trial_ends_at, feedback_opt_in')
    .eq('id', user.id)
    .single();

  const quota = await getQuotaState(supabase, user.id);
  const plan = (profile?.plan ?? 'free_trial') as Plan;
  const trialEndsAt = profile?.trial_ends_at ?? null;
  const trialDaysLeft =
    plan === 'free_trial' && trialEndsAt
      ? Math.max(
          0,
          Math.ceil((new Date(trialEndsAt).getTime() - Date.now()) / (1000 * 60 * 60 * 24)),
        )
      : null;

  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-component px-4 py-12">
      <h1 className="text-h2 text-grey-900">Settings</h1>

      <Card className="flex flex-col gap-subsection">
        <CardTitle>Account</CardTitle>
        <div className="flex items-center justify-between gap-4">
          <span className="text-body text-grey-500">Email</span>
          <span className="text-body text-grey-900">{profile?.email ?? user.email}</span>
        </div>
      </Card>

      <Card className="flex flex-col gap-subsection">
        <CardTitle>Plan</CardTitle>

        <div className="flex items-center justify-between gap-4">
          <span className="text-body text-grey-500">Current plan</span>
          <span className="text-body text-grey-900">{planLabel(plan)}</span>
        </div>

        <div className="flex items-center justify-between gap-4">
          <span className="text-body text-grey-500">Analyses used</span>
          <span className="text-body text-grey-900">
            {quota.limit === null ? `${quota.used} (unlimited)` : `${quota.used} of ${quota.limit}`}
          </span>
        </div>

        {quota.resetsAt && (
          <div className="flex items-center justify-between gap-4">
            <span className="text-body text-grey-500">
              {plan === 'free_trial' ? 'Trial ends' : 'Resets on'}
            </span>
            <span className="text-body text-grey-900">
              {formatDate(quota.resetsAt)}
              {trialDaysLeft !== null && (
                <span className="text-grey-400">
                  {' '}
                  ({trialDaysLeft} {trialDaysLeft === 1 ? 'day' : 'days'} left)
                </span>
              )}
            </span>
          </div>
        )}

        {/* No payment provider at MVP (A-06) — plan changes are operator-set,
            so there is no upgrade button or checkout here. */}
        <p className="text-caption text-grey-400">
          Plan changes are handled by our team — email support@contractiq.app.
        </p>
      </Card>

      <Card className="flex flex-col gap-subsection">
        <CardTitle>Privacy</CardTitle>
        <FeedbackOptInSwitch initial={profile?.feedback_opt_in ?? false} />
      </Card>

      <Card className="flex flex-col gap-subsection border-danger-100">
        <CardTitle className="text-danger-700">Danger zone</CardTitle>
        <DangerZone />
      </Card>
    </main>
  );
}
