import type { CapabilityKey } from '@/lib/capabilities';

/** Shared adapter result (spec 21 §4, P-2). */
export type AdapterResult<T> =
  | { ok: true; value: T }
  | { ok: false; reason: 'NOT_CONFIGURED'; capability: CapabilityKey }
  | { ok: false; reason: 'VENDOR_ERROR'; capability: CapabilityKey; message: string; retryable: boolean };

export function notConfigured<T>(capability: CapabilityKey): Promise<AdapterResult<T>> {
  return Promise.resolve({ ok: false, reason: 'NOT_CONFIGURED', capability });
}
