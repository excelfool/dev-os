'use client';

import { useState, useTransition } from 'react';
import { cn } from '@/lib/utils/cn';
import { setFeedbackOptIn } from '@/app/(app)/settings/actions';

export function FeedbackOptInSwitch({ initial }: { initial: boolean }) {
  const [enabled, setEnabled] = useState(initial);
  const [failed, setFailed] = useState(false);
  const [isPending, startTransition] = useTransition();

  function toggle() {
    const next = !enabled;
    setEnabled(next);
    setFailed(false);
    startTransition(async () => {
      const result = await setFeedbackOptIn(next);
      if (!result.ok) {
        setEnabled(!next); // roll back
        setFailed(true);
      }
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <span id="opt-in-label" className="text-body text-grey-900">
            Help improve extraction quality
          </span>
          <span className="text-caption text-grey-400">
            Allow ContractIQ to use your anonymised term corrections to improve extraction quality.
            Your contract text is never shared.
          </span>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          aria-labelledby="opt-in-label"
          onClick={toggle}
          disabled={isPending}
          className={cn(
            'relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-50',
            enabled ? 'bg-brand-500' : 'bg-grey-200',
          )}
        >
          <span
            className={cn(
              'absolute top-0.5 h-5 w-5 rounded-full bg-white transition-transform',
              enabled ? 'translate-x-[22px]' : 'translate-x-0.5',
            )}
          />
        </button>
      </div>
      {failed && (
        <p role="alert" className="text-caption text-danger-700">
          We couldn&apos;t save that change. Please try again.
        </p>
      )}
    </div>
  );
}
