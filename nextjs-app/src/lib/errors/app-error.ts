import { ERROR_DEFINITIONS, type ErrorCode } from './error-codes';
import { getCapability, type CapabilityKey } from '@/lib/capabilities';

/**
 * The only error type Route Handlers throw (spec 01 §2). Every non-Storage
 * failure produces an error envelope; there are no silent failures.
 */
export class AppError extends Error {
  constructor(
    readonly code: ErrorCode,
    readonly httpStatus: number,
    readonly userMessage: string,
    readonly retryable: boolean,
    readonly details?: Record<string, unknown>,
  ) {
    super(`${code}: ${userMessage}`);
    this.name = 'AppError';
  }

  toResponse(): Response {
    const headers = new Headers({ 'Content-Type': 'application/json' });
    if (this.code === 'RATE_LIMITED' && this.details?.retryAfterSeconds) {
      headers.set('Retry-After', String(this.details.retryAfterSeconds));
    }
    const body: Record<string, unknown> = {
      code: this.code,
      message: this.userMessage,
      retryable: this.retryable,
    };
    if (this.details?.fields) body.fields = this.details.fields;
    // P-4: the 501 envelope names the capability so the contract is testable
    // before the feature exists (spec 21 §1.3).
    if (this.code === 'NOT_IMPLEMENTED') {
      if (this.details?.capability) body.capability = this.details.capability;
      if (this.details?.phase) body.phase = this.details.phase;
    }

    return new Response(JSON.stringify({ error: body }), {
      status: this.httpStatus,
      headers,
    });
  }
}

/** Interpolates `{placeholder}` tokens in the code's canonical message. */
function interpolate(message: string, vars?: Record<string, string | number>): string {
  if (!vars) return message;
  return message.replace(/\{(\w+)\}/g, (match, key: string) =>
    key in vars ? String(vars[key]) : match,
  );
}

export function appError(
  code: ErrorCode,
  vars?: Record<string, string | number>,
  details?: Record<string, unknown>,
): AppError {
  const def = ERROR_DEFINITIONS[code];
  const merged = { ...('defaults' in def ? def.defaults : undefined), ...vars };
  return new AppError(code, def.httpStatus, interpolate(def.message, merged), def.retryable, details);
}

/** Overrides the canonical copy for the cases the spec gives distinct wording. */
export function appErrorWithMessage(
  code: ErrorCode,
  message: string,
  details?: Record<string, unknown>,
): AppError {
  const def = ERROR_DEFINITIONS[code];
  return new AppError(code, def.httpStatus, message, def.retryable, details);
}

/**
 * The 501 for a registered-but-unbuilt route (spec 21 §1.3, P-4). Throws if
 * called for a built capability — that is a programming error, not a 501.
 */
export function notImplemented(key: CapabilityKey): AppError {
  const c = getCapability(key);
  if (c.status === 'built') throw new Error(`notImplemented() called for built capability ${key}`);
  const phase = c.phase === '—' ? 'a later release' : c.phase;
  return appError('NOT_IMPLEMENTED', { label: c.label, phase }, {
    capability: key,
    phase: c.phase,
    status: c.status,
  });
}
