// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import { useChat } from '@/hooks/use-chat';
import type { ChatMessage } from '@/types/domain';

/**
 * The chat panel rendered one turn's answer twice, and sometimes dropped the
 * user's own question. Both come from one cause inside `useChat`: the
 * mount-time history GET applies its result unconditionally, so a load that
 * lands mid-turn overwrites state the turn is still building on.
 *
 * This interleaving lives entirely in the hook. Integration tests call the
 * route directly and have no hook at all; Playwright cannot order a promise
 * resolution against a React state update — three attempts to force it from a
 * browser failed, because StrictMode issues two loads per mount and the live
 * effect is not reliably the second to resolve. Here both fetches are deferred
 * and resolved by hand, so the order is stated rather than raced for.
 */

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

let loads: Array<Deferred<unknown>>;
let posts: Array<Deferred<unknown>>;

beforeEach(() => {
  loads = [];
  posts = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init?: RequestInit) => {
      const pending = deferred<unknown>();
      (init?.method === 'POST' ? posts : loads).push(pending);
      const body = await pending.promise;
      return { ok: true, json: async () => body } as Response;
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function message(id: string, role: 'user' | 'assistant', content: string, at: string): ChatMessage {
  return {
    id,
    role,
    content,
    cited_pages: role === 'assistant' ? [1] : null,
    citation_verified: true,
    query_class: null,
    latency_ms: null,
    created_at: at,
  };
}

const USER_ROW = message('user-1', 'user', 'What is the governing law', '2026-09-20T10:00:00.000Z');
const ASSISTANT_ROW = message(
  'assistant-1',
  'assistant',
  'Based on the document, the governing law is Delaware. [Page 1]',
  '2026-09-20T10:00:01.000Z',
);

/**
 * Starts a turn and returns its promise. Every fetch is deferred, so by the
 * time this returns the optimistic bubble is rendered and the POST is in
 * flight — nothing is resolved until the test says so.
 */
async function startTurn(
  send: (text: string) => Promise<void>,
): Promise<{ turn: Promise<void> }> {
  let turn!: Promise<void>;
  await act(async () => {
    turn = send('What is the governing law');
  });
  // Wrapped: an async function RETURNING a promise would await the whole turn,
  // which cannot settle until the test resolves the POST.
  return { turn };
}

describe('useChat — a history load that lands mid-turn', () => {
  it('does not render the answer twice when the load already contains it', async () => {
    const { result } = renderHook(() => useChat('contract-1'));
    expect(loads).toHaveLength(1);

    const { turn } = await startTurn(result.current.send);
    expect(posts).toHaveLength(1);

    // The POST has committed both rows, so the in-flight load now returns them.
    await act(async () => {
      loads[0]!.resolve({ messages: [USER_ROW, ASSISTANT_ROW] });
    });

    // Only now does the turn's own response reach the hook.
    await act(async () => {
      posts[0]!.resolve({ user_message_id: USER_ROW.id, assistant_message: ASSISTANT_ROW });
      await turn;
    });

    const assistants = result.current.messages.filter((m) => m.role === 'assistant');
    expect(assistants).toHaveLength(1);
    expect(result.current.messages.map((m) => m.id)).toEqual([USER_ROW.id, ASSISTANT_ROW.id]);
  });

  it('does not wipe the question when the load comes back empty', async () => {
    const { result } = renderHook(() => useChat('contract-1'));
    expect(loads).toHaveLength(1);

    const { turn } = await startTurn(result.current.send);
    expect(posts).toHaveLength(1);

    // The load was issued before the turn, so the server had nothing yet.
    await act(async () => {
      loads[0]!.resolve({ messages: [] });
    });

    // The user's question must survive an empty load landing underneath it.
    expect(result.current.messages.map((m) => m.role)).toEqual(['user']);
    expect(result.current.messages[0]!.content).toBe('What is the governing law');

    await act(async () => {
      posts[0]!.resolve({ user_message_id: USER_ROW.id, assistant_message: ASSISTANT_ROW });
      await turn;
    });

    expect(result.current.messages.map((m) => m.role)).toEqual(['user', 'assistant']);
  });

  it('still shows history that loaded before the turn began', async () => {
    const earlier = message('user-0', 'user', 'An earlier question', '2026-09-20T09:00:00.000Z');
    const { result } = renderHook(() => useChat('contract-1'));
    expect(loads).toHaveLength(1);

    await act(async () => {
      loads[0]!.resolve({ messages: [earlier] });
    });
    expect(result.current.messages).toHaveLength(1);

    const { turn } = await startTurn(result.current.send);
    expect(posts).toHaveLength(1);
    await act(async () => {
      posts[0]!.resolve({ user_message_id: USER_ROW.id, assistant_message: ASSISTANT_ROW });
      await turn;
    });

    expect(result.current.messages.map((m) => m.id)).toEqual([earlier.id, USER_ROW.id, ASSISTANT_ROW.id]);
  });

  it('keeps history that had not loaded yet when the turn began', async () => {
    const earlier = message('user-0', 'user', 'An earlier question', '2026-09-20T09:00:00.000Z');
    const { result } = renderHook(() => useChat('contract-1'));
    expect(loads).toHaveLength(1);

    // The turn starts before the load has come back at all.
    const { turn } = await startTurn(result.current.send);
    expect(posts).toHaveLength(1);

    // The load lands mid-turn carrying history the turn knows nothing about.
    await act(async () => {
      loads[0]!.resolve({ messages: [earlier] });
    });

    await act(async () => {
      posts[0]!.resolve({ user_message_id: USER_ROW.id, assistant_message: ASSISTANT_ROW });
      await turn;
    });

    // Held back, then merged in ahead of the turn — it is older than the turn.
    expect(result.current.messages.map((m) => m.id)).toEqual([
      earlier.id,
      USER_ROW.id,
      ASSISTANT_ROW.id,
    ]);
  });
});
