'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ChatMessage, ContractType } from '@/types/domain';

export const STARTER_QUESTIONS = (type: ContractType): string[] => [
  `What happens if I breach this ${type}?`,
  'Is there an auto-renewal clause?',
];

/** Appends only what is not already present, matched by id. */
function mergeById(base: ChatMessage[], incoming: ChatMessage[]): ChatMessage[] {
  return [...base, ...incoming.filter((m) => !base.some((existing) => existing.id === m.id))];
}

/** Single request/response turn — no streaming, no Realtime (A-07). */
export function useChat(contractId: string) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoaded, setIsLoaded] = useState(false);
  const [isAwaitingReply, setIsAwaitingReply] = useState(false);
  const [slowNotice, setSlowNotice] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** A failed turn restores the question so nothing is lost. */
  const [restoredDraft, setRestoredDraft] = useState<string | null>(null);
  /** Spec 20 §5.1: the latest turn reached ~3 unresolved turns. */
  const [escalationOffer, setEscalationOffer] = useState(false);

  /**
   * The mount-time history load used to apply its result unconditionally. When
   * it landed mid-turn it overwrote state the turn was still building on: if it
   * came back with the just-committed rows, the turn's own append then rendered
   * the answer TWICE; if it came back empty, it wiped the user's question.
   *
   * A load that arrives while a turn is in flight is therefore held rather than
   * applied — the turn's response is authoritative for its own two rows — and
   * merged in afterwards, so history that had not loaded yet is not lost. It is
   * prepended, because anything the load knows about and the turn does not is
   * older than the turn.
   */
  const turnInFlightRef = useRef(false);
  const pendingServerRef = useRef<ChatMessage[] | null>(null);

  const applyPendingLoad = useCallback((current: ChatMessage[]): ChatMessage[] => {
    const pending = pendingServerRef.current;
    pendingServerRef.current = null;
    if (!pending) return current;
    return mergeById(
      pending.filter((m) => !current.some((existing) => existing.id === m.id)),
      current,
    );
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch(`/api/contracts/${contractId}/chat`);
        if (!res.ok) return;
        const body = await res.json();
        if (cancelled) return;

        const server = (body.messages ?? []) as ChatMessage[];
        if (turnInFlightRef.current) {
          pendingServerRef.current = server;
          return;
        }
        setMessages(server);
      } finally {
        if (!cancelled) setIsLoaded(true);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [contractId]);

  useEffect(() => {
    if (!isAwaitingReply) {
      setSlowNotice(false);
      return;
    }
    const timer = setTimeout(() => setSlowNotice(true), 15_000);
    return () => clearTimeout(timer);
  }, [isAwaitingReply]);

  const send = useCallback(
    async (text: string) => {
      setError(null);
      setRestoredDraft(null);
      setEscalationOffer(false);
      setIsAwaitingReply(true);
      turnInFlightRef.current = true;

      // Optimistic user bubble.
      const optimistic: ChatMessage = {
        id: `optimistic-${Date.now()}`,
        role: 'user',
        content: text,
        cited_pages: null,
        citation_verified: true,
        query_class: null,
        latency_ms: null,
        created_at: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, optimistic]);

      try {
        const res = await fetch(`/api/contracts/${contractId}/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: text }),
        });
        const body = await res.json();

        if (!res.ok) {
          setMessages((prev) => applyPendingLoad(prev.filter((m) => m.id !== optimistic.id)));
          setError(body.error?.message ?? 'Something went wrong on our side. Please try again.');
          setRestoredDraft(text);
          return;
        }

        setMessages((prev) => {
          const renamed = prev.map((m) =>
            m.id === optimistic.id ? { ...m, id: body.user_message_id } : m,
          );
          return applyPendingLoad(mergeById(renamed, [body.assistant_message as ChatMessage]));
        });
        setEscalationOffer(body.escalation_offer === true);
      } catch {
        setMessages((prev) => applyPendingLoad(prev.filter((m) => m.id !== optimistic.id)));
        setError("We couldn't reach the AI service. Try again in a few minutes.");
        setRestoredDraft(text);
      } finally {
        turnInFlightRef.current = false;
        setIsAwaitingReply(false);
      }
    },
    [contractId, applyPendingLoad],
  );

  return { messages, isLoaded, isAwaitingReply, slowNotice, error, restoredDraft, escalationOffer, send };
}
