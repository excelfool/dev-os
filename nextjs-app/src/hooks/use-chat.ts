'use client';

import { useCallback, useEffect, useState } from 'react';
import type { ChatMessage, ContractType } from '@/types/domain';

export const STARTER_QUESTIONS = (type: ContractType): string[] => [
  `What happens if I breach this ${type}?`,
  'Is there an auto-renewal clause?',
];

/** Single request/response turn — no streaming, no Realtime (A-07). */
export function useChat(contractId: string) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoaded, setIsLoaded] = useState(false);
  const [isAwaitingReply, setIsAwaitingReply] = useState(false);
  const [slowNotice, setSlowNotice] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** A failed turn restores the question so nothing is lost. */
  const [restoredDraft, setRestoredDraft] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch(`/api/contracts/${contractId}/chat`);
        if (!res.ok) return;
        const body = await res.json();
        if (!cancelled) setMessages(body.messages ?? []);
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
      setIsAwaitingReply(true);

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
          setMessages((prev) => prev.filter((m) => m.id !== optimistic.id));
          setError(body.error?.message ?? 'Something went wrong on our side. Please try again.');
          setRestoredDraft(text);
          return;
        }

        setMessages((prev) => [
          ...prev.map((m) => (m.id === optimistic.id ? { ...m, id: body.user_message_id } : m)),
          body.assistant_message as ChatMessage,
        ]);
      } catch {
        setMessages((prev) => prev.filter((m) => m.id !== optimistic.id));
        setError("We couldn't reach the AI service. Try again in a few minutes.");
        setRestoredDraft(text);
      } finally {
        setIsAwaitingReply(false);
      }
    },
    [contractId],
  );

  return { messages, isLoaded, isAwaitingReply, slowNotice, error, restoredDraft, send };
}
