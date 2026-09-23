'use client';

import { useEffect, useRef } from 'react';
import { PageCitationChip } from './PageCitationChip';
import { EscalateOffer } from '@/components/risk/EscalateOffer';
import { HhhQuestionnaire } from '@/components/review/HhhQuestionnaire';
import { useReviewMode } from '@/hooks/use-review-mode';
import { cn } from '@/lib/utils/cn';
import type { ChatMessage } from '@/types/domain';

export function MessageList({
  messages,
  isAwaitingReply,
  slowNotice,
  contractId,
  escalationOffer = false,
}: {
  messages: ChatMessage[];
  isAwaitingReply: boolean;
  slowNotice: boolean;
  /** Spec 22 §4: needed to score an answer; absent outside a contract. */
  contractId?: string;
  /** Spec 20 §5.1: render EscalateOffer under the last assistant bubble. */
  escalationOffer?: boolean;
}) {
  const lastAssistantId = [...messages].reverse().find((m) => m.role === 'assistant')?.id;
  const endRef = useRef<HTMLDivElement>(null);
  const review = useReviewMode();

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [messages.length, isAwaitingReply]);

  return (
    <div className="flex flex-1 flex-col gap-3 overflow-y-auto p-4">
      {messages.map((message) => (
        <div
          key={message.id}
          className={cn('flex flex-col gap-1', message.role === 'user' ? 'items-end' : 'items-start')}
        >
          <div
            className={cn(
              'max-w-[85%] whitespace-pre-wrap rounded-card px-3 py-2 text-body',
              message.role === 'user' ? 'bg-brand-500 text-white' : 'bg-grey-50 text-grey-900',
            )}
          >
            {message.content}
          </div>

          {message.role === 'assistant' && (
            <>
              {message.cited_pages && message.cited_pages.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {message.cited_pages.map((page) => (
                    <PageCitationChip key={page} page={page} />
                  ))}
                </div>
              )}
              {!message.citation_verified && (
                <p className="text-caption text-warning-900">
                  We couldn&apos;t confirm a page reference for this answer — check the document
                  directly.
                </p>
              )}
              {review?.reviewMode && contractId && (
                <HhhQuestionnaire
                  contractId={contractId}
                  subjectType="message"
                  messageId={message.id}
                  label="Review this answer"
                />
              )}
              {escalationOffer && message.id === lastAssistantId && <EscalateOffer />}
            </>
          )}
        </div>
      ))}

      {isAwaitingReply && (
        <p aria-live="polite" className="text-caption text-grey-400">
          {slowNotice ? 'Still reading your contract…' : 'Reading your contract…'}
        </p>
      )}

      {/* New assistant messages are announced politely. */}
      <div aria-live="polite" className="sr-only-live">
        {messages.at(-1)?.role === 'assistant' ? 'New answer received' : ''}
      </div>

      <div ref={endRef} />
    </div>
  );
}
