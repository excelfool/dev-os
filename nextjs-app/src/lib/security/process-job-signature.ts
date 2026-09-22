import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * HMAC signing for the background processing job (spec 06 v1.1 §G, D49 a).
 *
 * The route signs `{ contract_id, user_id, issued_at }` with the server-side
 * PROCESS_JOB_SECRET and the background function verifies it before touching
 * the database, so the function URL — which Netlify exposes publicly — cannot
 * be driven by anyone without the secret. No `server-only` import: the
 * Netlify function bundles this file outside the Next.js runtime.
 */

export const PROCESS_JOB_SIGNATURE_HEADER = 'x-process-job-signature';
/** A signed job older than this is refused even with a valid signature. */
export const PROCESS_JOB_MAX_AGE_MS = 10 * 60 * 1000;

export interface ProcessJobPayload {
  contract_id: string;
  user_id: string;
  /** ms since epoch, set by the route at enqueue time. */
  issued_at: number;
}

export function signProcessJob(rawBody: string, secret: string): string {
  return 'sha256=' + createHmac('sha256', secret).update(rawBody).digest('hex');
}

export type ProcessJobVerification =
  | { ok: true; payload: ProcessJobPayload }
  | { ok: false; reason: 'missing_signature' | 'bad_signature' | 'malformed' | 'expired' };

export function verifyProcessJob(
  rawBody: string,
  signature: string | null,
  secret: string,
  now: number = Date.now(),
): ProcessJobVerification {
  if (!signature) return { ok: false, reason: 'missing_signature' };
  const expected = Buffer.from(signProcessJob(rawBody, secret));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) {
    return { ok: false, reason: 'bad_signature' };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return { ok: false, reason: 'malformed' };
  }
  const p = parsed as Partial<ProcessJobPayload> | null;
  if (
    !p ||
    typeof p.contract_id !== 'string' ||
    typeof p.user_id !== 'string' ||
    typeof p.issued_at !== 'number'
  ) {
    return { ok: false, reason: 'malformed' };
  }
  if (now - p.issued_at > PROCESS_JOB_MAX_AGE_MS || p.issued_at - now > 60_000) {
    return { ok: false, reason: 'expired' };
  }
  return { ok: true, payload: { contract_id: p.contract_id, user_id: p.user_id, issued_at: p.issued_at } };
}
