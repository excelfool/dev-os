import 'server-only';
import { getServerConfig } from '@/lib/utils/server-config';
import { appError } from '@/lib/errors/app-error';
import {
  PROCESS_JOB_SIGNATURE_HEADER,
  signProcessJob,
  type ProcessJobPayload,
} from '@/lib/security/process-job-signature';

/**
 * Hand-off from `POST /process` to the Netlify background function
 * (spec 06 v1.1 §G, D49 a). Enabled by the presence of PROCESS_JOB_SECRET;
 * without it the route runs the pipeline inline (local dev, tests).
 */

export const PROCESS_BACKGROUND_PATH = '/.netlify/functions/process-background';

export function isAsyncPipelineEnabled(): boolean {
  return Boolean(getServerConfig().PROCESS_JOB_SECRET);
}

/** Where the job is posted: an explicit override (tests), else the site's own function URL. */
export function processJobUrl(): string {
  const cfg = getServerConfig();
  if (cfg.PROCESS_JOB_URL) return cfg.PROCESS_JOB_URL;
  // Netlify sets URL to the site's primary origin at build and run time.
  const origin = process.env.URL || process.env.NEXT_PUBLIC_SITE_URL;
  if (!origin) throw new Error('PROCESS_JOB_URL or URL/NEXT_PUBLIC_SITE_URL must be set to enqueue a process job');
  return new URL(PROCESS_BACKGROUND_PATH, origin).toString();
}

/**
 * Posts the signed job. Netlify answers a background function with 202 the
 * moment it is queued; anything else means the job was NOT queued and the
 * caller must release its claim.
 */
export async function enqueueProcessJob(contractId: string, userId: string): Promise<void> {
  const secret = getServerConfig().PROCESS_JOB_SECRET;
  if (!secret) throw new Error('enqueueProcessJob called without PROCESS_JOB_SECRET');

  const payload: ProcessJobPayload = { contract_id: contractId, user_id: userId, issued_at: Date.now() };
  const body = JSON.stringify(payload);

  let res: Response;
  try {
    res = await fetch(processJobUrl(), {
      method: 'POST',
      headers: { 'content-type': 'application/json', [PROCESS_JOB_SIGNATURE_HEADER]: signProcessJob(body, secret) },
      body,
      signal: AbortSignal.timeout(5_000),
    });
  } catch (err) {
    console.error(JSON.stringify({ process_job: 'enqueue_failed', contractId, error: String(err) }));
    throw appError('INTERNAL');
  }
  if (res.status < 200 || res.status >= 300) {
    console.error(JSON.stringify({ process_job: 'enqueue_rejected', contractId, status: res.status }));
    throw appError('INTERNAL');
  }
}
