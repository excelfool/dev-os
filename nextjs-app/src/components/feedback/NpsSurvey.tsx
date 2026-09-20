'use client';

import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils/cn';

const DISMISS_KEY = 'contractiq:nps_dismissed_until';
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * NPS at session end (spec 10 §3): either the user marks a review complete, or
 * 15 minutes of inactivity — whichever comes first. Dismissing counts as
 * declining and writes no row.
 */
export function NpsSurvey({ trigger }: { trigger: boolean }) {
  const [visible, setVisible] = useState(false);
  const [score, setScore] = useState<number | null>(null);
  const [comment, setComment] = useState('');
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    if (!trigger) return;
    try {
      const until = localStorage.getItem(DISMISS_KEY);
      if (until && Number(until) > Date.now()) return;
    } catch {
      // Private mode or blocked storage — showing the prompt is the safe default.
    }
    setVisible(true);
  }, [trigger]);

  function dismiss() {
    setVisible(false);
    try {
      localStorage.setItem(DISMISS_KEY, String(Date.now() + THIRTY_DAYS_MS));
    } catch {
      /* nothing actionable */
    }
  }

  async function submit() {
    if (score === null) return;
    const res = await fetch('/api/nps', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ score, comment: comment.trim() || undefined }),
    });
    // 409 ALREADY_SURVEYED is a normal outcome, not an error to surface.
    if (res.ok || res.status === 409) {
      setSubmitted(true);
      try {
        localStorage.setItem(DISMISS_KEY, String(Date.now() + THIRTY_DAYS_MS));
      } catch {
        /* nothing actionable */
      }
      setTimeout(() => setVisible(false), 1500);
    }
  }

  if (!visible) return null;

  return (
    <aside
      aria-label="Net promoter survey"
      className="fixed bottom-6 left-6 z-30 w-[calc(100vw-3rem)] max-w-sm rounded-card border border-grey-100 bg-white p-4 shadow-xl"
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-body text-grey-900">
          How likely are you to recommend ContractIQ to a colleague?
        </p>
        <button type="button" onClick={dismiss} aria-label="Dismiss survey">
          <X aria-hidden="true" className="h-4 w-4 text-grey-400" />
        </button>
      </div>

      {submitted ? (
        <p className="mt-3 text-caption text-grey-500">Thanks — that helps.</p>
      ) : (
        <>
          <div className="mt-3 flex flex-wrap gap-1" role="radiogroup" aria-label="Score from 0 to 10">
            {Array.from({ length: 11 }, (_, n) => (
              <button
                key={n}
                type="button"
                role="radio"
                aria-checked={score === n}
                onClick={() => setScore(n)}
                className={cn(
                  'h-8 w-8 rounded-btn border text-caption',
                  score === n
                    ? 'border-brand-500 bg-brand-500 text-white'
                    : 'border-grey-200 text-grey-600 hover:bg-grey-25',
                )}
              >
                {n}
              </button>
            ))}
          </div>

          <textarea
            rows={2}
            maxLength={1000}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            aria-label="Optional comment"
            placeholder="Anything you'd like to add? (optional)"
            className="mt-3 w-full rounded-input border border-grey-200 px-3 py-2 text-caption text-grey-900 placeholder:text-grey-300"
          />

          <Button size="sm" className="mt-2" disabled={score === null} onClick={() => void submit()}>
            Send
          </Button>
        </>
      )}
    </aside>
  );
}
