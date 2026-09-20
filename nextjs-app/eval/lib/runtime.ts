import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * Loads .env.local the way `next dev` would, since runners execute outside
 * Next. Called before anything imports server-config, which validates on first
 * use.
 */
export function loadEnv(): void {
  const path = resolve(process.cwd(), '.env.local');
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!match) continue;
    const [, key, raw] = match;
    if (process.env[key!] === undefined) process.env[key!] = raw!.trim();
  }
}

export function serviceClient(): SupabaseClient {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

const EVAL_OPERATOR_EMAIL = 'eval.operator@contractiq.local';

/**
 * Spec 17 §7: eval spend is tagged in `openai_calls` by running under a
 * dedicated operator user id, so it can be excluded from the production cost
 * rollup. That requires the id to be a real user, or the insert is rejected by
 * the foreign key and the spend goes unattributed.
 */
export async function evalOperatorId(supabase: SupabaseClient): Promise<string> {
  const { data: list } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 });
  const existing = list?.users.find((u) => u.email === EVAL_OPERATOR_EMAIL);
  if (existing) return existing.id;

  const { data, error } = await supabase.auth.admin.createUser({
    email: EVAL_OPERATOR_EMAIL,
    password: `eval-${crypto.randomUUID()}`,
    email_confirm: true,
  });
  if (error || !data.user) throw new Error(`Could not create the eval operator: ${error?.message}`);
  return data.user.id;
}

export function releaseTag(): string {
  return process.env.EVAL_RELEASE ?? new Date().toISOString().slice(0, 10);
}
