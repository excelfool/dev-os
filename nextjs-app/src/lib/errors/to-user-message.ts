import { ZodError } from 'zod';
import { AppError, appError } from './app-error';

/**
 * Maps any thrown value to an AppError (spec 01 §2). A ZodError becomes a 400
 * carrying a field map; anything else becomes INTERNAL.
 */
export function toAppError(err: unknown): AppError {
  if (err instanceof AppError) return err;

  if (err instanceof ZodError) {
    const fields: Record<string, string> = {};
    for (const issue of err.issues) {
      const key = issue.path.join('.') || '_';
      if (!(key in fields)) fields[key] = issue.message;
    }
    return appError('VALIDATION', undefined, { fields });
  }

  return appError('INTERNAL');
}

export interface RequestLogContext {
  requestId: string;
  userId?: string;
  route: string;
  method: string;
}

/**
 * Wraps every Route Handler body. Emits exactly one structured JSON log line
 * per request. Contract text, term values and chat content are never logged
 * (spec 13 §8).
 */
/**
 * The handler receives the SAME context object the logger reads, so a route
 * attaches the user the moment it has resolved the session — before any body
 * logic — and every subsequent line, including a 500's `unexpected` line,
 * carries the userId. Previously the context was fixed at wrap time, before
 * any route could know the user, so a production 500 logged userId:null on an
 * authenticated request and could not be tied to anyone.
 */
export async function withErrorHandling(
  context: Omit<RequestLogContext, 'requestId'> & { requestId?: string },
  handler: (ctx: RequestLogContext) => Promise<Response>,
): Promise<Response> {
  const ctx: RequestLogContext = { ...context, requestId: context.requestId ?? crypto.randomUUID() };
  const startedAt = Date.now();

  try {
    const response = await handler(ctx);
    log(ctx, response.status, Date.now() - startedAt, 'success');
    return response;
  } catch (err) {
    const appErr = toAppError(err);
    // An unexpected failure is logged with its stack server-side; the user only
    // ever sees the taxonomy's copy.
    if (appErr.code === 'INTERNAL' && !(err instanceof AppError)) {
      console.error(
        JSON.stringify({
          requestId: ctx.requestId,
          userId: ctx.userId ?? null,
          route: ctx.route,
          unexpected: String(err),
        }),
      );
    }
    log(ctx, appErr.httpStatus, Date.now() - startedAt, 'error', appErr.code);
    return appErr.toResponse();
  }
}

function log(
  ctx: RequestLogContext,
  status: number,
  durationMs: number,
  outcome: 'success' | 'error',
  errorCode?: string,
): void {
  console.log(
    JSON.stringify({
      requestId: ctx.requestId,
      userId: ctx.userId ?? null,
      route: ctx.route,
      method: ctx.method,
      status,
      durationMs,
      outcome,
      ...(errorCode ? { errorCode } : {}),
    }),
  );
}
