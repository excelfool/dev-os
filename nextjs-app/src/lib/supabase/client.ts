import { createBrowserClient } from '@supabase/ssr';
import { publicConfig } from '@/lib/utils/config';

/**
 * Browser client, anon key (spec 01 §3). Used by Client Components for auth
 * calls and nothing else privileged — RLS constrains it.
 */
export function createBrowserSupabaseClient() {
  return createBrowserClient(publicConfig.supabaseUrl, publicConfig.supabaseAnonKey);
}
