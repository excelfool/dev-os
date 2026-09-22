import 'server-only';
import { createClient } from '@supabase/supabase-js';
import { getServerConfig } from '@/lib/utils/server-config';
import { publicConfig } from '@/lib/utils/config';

/**
 * Service-role client — bypasses RLS.
 *
 * Sanctioned call sites are the authoritative list in spec 13 §2, and nothing
 * else: DELETE /api/account (auth-user deletion), the purge-expired-pdfs and
 * send-notification Edge Functions, and the increment_rate_limit /
 * acquire_analysis_slot / release_analysis_slot / consume_analysis_quota /
 * refund_analysis_quota RPCs, and (7) the process-background Netlify function
 * via `runProcessJob` in src/lib/services/process-job-runner.ts — it has no
 * user session, only a job the route signed (spec 06 v1.1 §G). Any other
 * import inside src/** is a review-blocking error.
 */
export function createAdminSupabaseClient() {
  return createClient(publicConfig.supabaseUrl, getServerConfig().SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
