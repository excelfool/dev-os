import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getServerConfig } from '@/lib/utils/server-config';
import { appError, appErrorWithMessage } from '@/lib/errors/app-error';
import { TRIAL_ENDED_MESSAGE } from '@/lib/errors/error-codes';
import type { Plan, QuotaState } from '@/types/domain';

/**
 * Plan quota (spec 13 §5). There is no payment provider at MVP (A-06):
 * `profiles.plan` is operator-set and this layer is provider-agnostic.
 *
 * Counting is deletion-proof — the counter is `profiles.analyses_used`, not a
 * live COUNT(*) over contracts, which a user could reset by deleting a row.
 */

export interface QuotaWindow {
  limit: number | null; // null = unlimited
  periodStart: Date;
  resetsAt: Date | null;
  trialExpired: boolean;
}

export function quotaWindowFor(
  plan: Plan,
  trialEndsAt: string | null,
  profileCreatedAt: string,
  now = new Date(),
): QuotaWindow {
  const cfg = getServerConfig();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const nextMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));

  if (plan === 'free_trial') {
    const expired = !trialEndsAt || new Date(trialEndsAt) <= now;
    return {
      // An expired trial has a limit of 0 and its own copy. The plan value
      // itself is never mutated by code — only an operator changes it.
      limit: expired ? 0 : cfg.QUOTA_FREE_TRIAL_TOTAL,
      // free_trial counts a total across the trial, not per month.
      periodStart: new Date(profileCreatedAt),
      resetsAt: trialEndsAt ? new Date(trialEndsAt) : null,
      trialExpired: expired,
    };
  }

  if (plan === 'pro') {
    return { limit: null, periodStart: monthStart, resetsAt: null, trialExpired: false };
  }

  return {
    limit: plan === 'starter' ? cfg.QUOTA_STARTER_PER_MONTH : cfg.QUOTA_GROWTH_PER_MONTH,
    periodStart: monthStart,
    resetsAt: nextMonth,
    trialExpired: false,
  };
}

interface QuotaProfileRow {
  plan: Plan;
  trial_ends_at: string | null;
  created_at: string;
  analyses_used: number;
  quota_period_start: string;
}

async function loadProfile(
  supabase: SupabaseClient,
  userId: string,
): Promise<QuotaProfileRow> {
  const { data, error } = await supabase
    .from('profiles')
    .select('plan, trial_ends_at, created_at, analyses_used, quota_period_start')
    .eq('id', userId)
    .single();

  if (error || !data) throw appError('INTERNAL');
  return data as QuotaProfileRow;
}

/** Read-only state for /settings — never consumes a unit. */
export async function getQuotaState(
  supabase: SupabaseClient,
  userId: string,
): Promise<QuotaState> {
  const profile = await loadProfile(supabase, userId);
  const window = quotaWindowFor(profile.plan, profile.trial_ends_at, profile.created_at);

  // Usage from an elapsed period reads as zero — the counter rolls on the next
  // consume, and showing last period's number would be wrong.
  const used =
    new Date(profile.quota_period_start) < window.periodStart ? 0 : profile.analyses_used;

  return {
    plan: profile.plan,
    used,
    limit: window.limit,
    remaining: window.limit === null ? null : Math.max(window.limit - used, 0),
    resetsAt: window.resetsAt ? window.resetsAt.toISOString() : null,
  };
}

/**
 * Read-only pre-check used by the upload route before any file work. The unit
 * itself is consumed later, immediately before the contracts insert.
 */
export async function assertQuota(
  supabase: SupabaseClient,
  userId: string,
): Promise<QuotaState & { periodStart: Date }> {
  const profile = await loadProfile(supabase, userId);
  const window = quotaWindowFor(profile.plan, profile.trial_ends_at, profile.created_at);
  const used =
    new Date(profile.quota_period_start) < window.periodStart ? 0 : profile.analyses_used;

  if (window.trialExpired) {
    throw appErrorWithMessage('QUOTA_EXCEEDED', TRIAL_ENDED_MESSAGE);
  }

  if (window.limit !== null && used >= window.limit) {
    throw appError('QUOTA_EXCEEDED', { limit: window.limit, plan: planLabel(profile.plan) });
  }

  return {
    plan: profile.plan,
    used,
    limit: window.limit,
    remaining: window.limit === null ? null : Math.max(window.limit - used, 0),
    resetsAt: window.resetsAt ? window.resetsAt.toISOString() : null,
    periodStart: window.periodStart,
  };
}

export function planLabel(plan: Plan): string {
  return { free_trial: 'Free Trial', starter: 'Starter', growth: 'Growth', pro: 'Pro' }[plan];
}

/**
 * Consumes one analysis unit (spec 13 §5). Called at upload, immediately after
 * all file validation passes and immediately before the contracts insert — the
 * point at which the analysis is committed.
 *
 * `consume_analysis_quota` is service_role-only, so this is a sanctioned
 * admin-client call site (spec 13 §2 item 4).
 */
export async function consumeQuotaUnit(userId: string, periodStart: Date): Promise<number> {
  const { createAdminSupabaseClient } = await import('@/lib/supabase/admin');
  const admin = createAdminSupabaseClient();
  const { data, error } = await admin.rpc('consume_analysis_quota', {
    p_user_id: userId,
    p_period_start: periodStart.toISOString(),
  });
  if (error) throw appError('INTERNAL');
  return Number(data);
}

/** Releases a consumed unit when a later step of the upload fails. */
export async function refundQuotaUnit(userId: string): Promise<void> {
  const { createAdminSupabaseClient } = await import('@/lib/supabase/admin');
  const admin = createAdminSupabaseClient();
  const { error } = await admin.rpc('refund_analysis_quota', { p_user_id: userId });
  if (error) {
    // Logged rather than thrown: the user's error is the one that matters, and
    // over-counting a unit must never mask it.
    console.error(JSON.stringify({ quota: 'refund_failed', userId }));
  }
}
