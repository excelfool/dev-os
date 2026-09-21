import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { withErrorHandling } from '@/lib/errors/to-user-message';
import { appError } from '@/lib/errors/app-error';

/**
 * A production 500 logged userId:null on an authenticated request, because
 * the log context was fixed at wrap time — before any route could know the
 * user. The handler now receives the same context object the logger reads.
 */

let logs: string[];
let errors: string[];

beforeEach(() => {
  logs = [];
  errors = [];
  vi.spyOn(console, 'log').mockImplementation((line: string) => { logs.push(line); });
  vi.spyOn(console, 'error').mockImplementation((line: string) => { errors.push(line); });
});

afterEach(() => vi.restoreAllMocks());

describe('withErrorHandling — the user on every log line', () => {
  it('carries the userId a handler attached into a 500 unexpected line and the request line', async () => {
    const res = await withErrorHandling({ route: '/api/x', method: 'POST' }, async (ctx) => {
      ctx.userId = 'user-42';
      throw new ReferenceError('DOMMatrix is not defined');
    });

    expect(res.status).toBe(500);
    expect(errors).toHaveLength(1);
    expect(JSON.parse(errors[0]!)).toMatchObject({
      userId: 'user-42',
      route: '/api/x',
      unexpected: 'ReferenceError: DOMMatrix is not defined',
    });
    expect(logs).toHaveLength(1);
    expect(JSON.parse(logs[0]!)).toMatchObject({ userId: 'user-42', status: 500, outcome: 'error', errorCode: 'INTERNAL' });
  });

  it('carries the userId on a success line too', async () => {
    await withErrorHandling({ route: '/api/x', method: 'GET' }, async (ctx) => {
      ctx.userId = 'user-42';
      return Response.json({ ok: true });
    });
    expect(JSON.parse(logs[0]!)).toMatchObject({ userId: 'user-42', status: 200, outcome: 'success' });
  });

  it('logs null when the request never authenticated', async () => {
    await withErrorHandling({ route: '/api/x', method: 'GET' }, async () => {
      throw appError('UNAUTHENTICATED');
    });
    expect(JSON.parse(logs[0]!)).toMatchObject({ userId: null, status: 401 });
    // A taxonomy error is expected, not unexpected — no console.error.
    expect(errors).toHaveLength(0);
  });
});
