import { describe, expect, it } from 'vitest';
import {
  PROCESS_JOB_MAX_AGE_MS,
  signProcessJob,
  verifyProcessJob,
} from '@/lib/security/process-job-signature';

/** Spec 06 v1.1 §G — the HMAC that gates the background function. */

const SECRET = 'unit-test-secret';
const now = 1_800_000_000_000;
const body = JSON.stringify({ contract_id: 'c-1', user_id: 'u-1', issued_at: now });

describe('process job signature', () => {
  it('signs deterministically with sha256= prefix and verifies', () => {
    const sig = signProcessJob(body, SECRET);
    expect(sig).toMatch(/^sha256=[0-9a-f]{64}$/);
    expect(signProcessJob(body, SECRET)).toBe(sig);
    expect(verifyProcessJob(body, sig, SECRET, now)).toEqual({
      ok: true,
      payload: { contract_id: 'c-1', user_id: 'u-1', issued_at: now },
    });
  });

  it('rejects a missing, tampered or wrong-secret signature', () => {
    const sig = signProcessJob(body, SECRET);
    expect(verifyProcessJob(body, null, SECRET, now)).toEqual({ ok: false, reason: 'missing_signature' });
    expect(verifyProcessJob(body.replace('u-1', 'u-2'), sig, SECRET, now)).toEqual({ ok: false, reason: 'bad_signature' });
    expect(verifyProcessJob(body, signProcessJob(body, 'other'), SECRET, now)).toEqual({ ok: false, reason: 'bad_signature' });
    expect(verifyProcessJob(body, 'sha256=short', SECRET, now)).toEqual({ ok: false, reason: 'bad_signature' });
  });

  it('rejects a malformed payload even when correctly signed', () => {
    const bad = JSON.stringify({ contract_id: 'c-1' });
    expect(verifyProcessJob(bad, signProcessJob(bad, SECRET), SECRET, now)).toEqual({ ok: false, reason: 'malformed' });
    const notJson = 'nope';
    expect(verifyProcessJob(notJson, signProcessJob(notJson, SECRET), SECRET, now)).toEqual({ ok: false, reason: 'malformed' });
  });

  it('rejects a job older than the replay window', () => {
    const sig = signProcessJob(body, SECRET);
    expect(verifyProcessJob(body, sig, SECRET, now + PROCESS_JOB_MAX_AGE_MS + 1)).toEqual({ ok: false, reason: 'expired' });
    expect(verifyProcessJob(body, sig, SECRET, now + PROCESS_JOB_MAX_AGE_MS - 1).ok).toBe(true);
  });
});
