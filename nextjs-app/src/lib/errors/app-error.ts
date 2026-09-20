import { ERROR_DEFINITIONS, type ErrorCode } from './error-codes';

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
