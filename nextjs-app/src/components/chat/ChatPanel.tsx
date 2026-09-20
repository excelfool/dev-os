'use client';

import { useEffect, useState } from 'react';
import { MessageSquare, Send, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { MessageList } from './MessageList';
import { useChat, STARTER_QUESTIONS } from '@/hooks/use-chat';
import type { ContractType } from '@/types/domain';

/**
 * Chat opens INSIDE the results view — the document and terms panels stay
 * mounted (spec 08 §1).
 */
export function ChatPanel({
  contractId,
  contractType,
}: {
  contractId: string;
  contractType: ContractType;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const { messages, isAwaitingReply, slowNotice, error, restoredDraft, send } = useChat(contractId);

  useEffect(() => {
    if (restoredDraft !== null) setDraft(restoredDraft);
  }, [restoredDraft]);

  async function submit() {
    const text = draft.trim();
    if (text.length === 0 || text.length > 2000 || isAwaitingReply) return;
    setDraft('');
    await send(text);
  }

  if (!isOpen) {
    return (
      <Button onClick={() => setIsOpen(true)} className="fixed bottom-6 right-6 shadow-lg">
        <MessageSquare aria-hidden="true" className="h-4 w-4" />
        Chat with Contract
      </Button>
    );
  }

  return (
    <aside
      aria-label="Chat with contract"
      className="fixed bottom-0 right-0 z-30 flex h-[70vh] w-full flex-col rounded-t-card border border-grey-100 bg-white shadow-xl sm:bottom-6 sm:right-6 sm:h-[60vh] sm:w-[420px] sm:rounded-card"
    >
      <header className="flex items-center justify-between border-b border-grey-50 px-4 py-3">
        <h2 className="text-body text-grey-900">Chat with Contract</h2>
        <button type="button" onClick={() => setIsOpen(false)} aria-label="Close chat">
          <X aria-hidden="true" className="h-4 w-4 text-grey-400" />
        </button>
      </header>

      {messages.length === 0 && !isAwaitingReply ? (
        <div className="flex flex-1 flex-col justify-end gap-2 p-4">
          <p className="text-caption text-grey-400">Try asking:</p>
          {STARTER_QUESTIONS(contractType).map((question) => (
            <button
              key={question}
              type="button"
              onClick={() => setDraft(question)}
              className="rounded-card border border-grey-100 px-3 py-2 text-left text-body text-grey-600 hover:bg-grey-25"
            >
              {question}
            </button>
          ))}
        </div>
      ) : (
        <MessageList messages={messages} isAwaitingReply={isAwaitingReply} slowNotice={slowNotice} />
      )}

      {error && (
        <p role="alert" className="px-4 pb-2 text-caption text-danger-700">
          {error}
        </p>
      )}

      <div className="flex items-end gap-2 border-t border-grey-50 p-3">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void submit();
            }
          }}
          disabled={isAwaitingReply}
          rows={2}
          maxLength={2000}
          aria-label="Ask a question about this contract"
          placeholder="Ask in plain English…"
          className="flex-1 resize-none rounded-input border border-grey-200 px-3 py-2 text-body text-grey-900 placeholder:text-grey-300 disabled:bg-grey-25"
        />
        <Button
          onClick={() => void submit()}
          disabled={isAwaitingReply || draft.trim().length === 0}
          aria-label="Send question"
        >
          <Send aria-hidden="true" className="h-4 w-4" />
        </Button>
      </div>
    </aside>
  );
}
