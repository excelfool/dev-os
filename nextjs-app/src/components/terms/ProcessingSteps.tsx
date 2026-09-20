'use client';

import { useEffect, useState } from 'react';
import { Check, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils/cn';

/**
 * The literal three steps from PRD §4 Flow 3 step 4 (spec 06 §5). There is no
 * cancel control — the PRD describes an uninterrupted run.
 */
export type ProcessingStage = 'extracting' | 'analysing' | 'compiling';

const STEPS: Array<{ id: ProcessingStage; label: string }> = [
  { id: 'extracting', label: 'Extracting text' },
  { id: 'analysing', label: 'Analysing with AI' },
  { id: 'compiling', label: 'Compiling results' },
];

export function ProcessingSteps({
  stage,
  failedAt,
  errorMessage,
  onRetry,
}: {
  stage: ProcessingStage;
  failedAt?: ProcessingStage | null;
  errorMessage?: string | null;
  onRetry?: () => void;
}) {
  const [elapsed, setElapsed] = useState(0);
  const activeIndex = STEPS.findIndex((s) => s.id === stage);

  useEffect(() => {
    if (failedAt) return;
    const timer = setInterval(() => setElapsed((n) => n + 1), 1000);
    return () => clearInterval(timer);
  }, [failedAt]);

  return (
    <div className="flex flex-col gap-subsection rounded-card border border-grey-100 p-6">
      <ol className="flex flex-col gap-3" aria-live="polite">
        {STEPS.map((step, index) => {
          // Step 1 is complete on arrival — extraction happened at upload.
          const isComplete = index < activeIndex;
          const isActive = index === activeIndex && !failedAt;
          const isFailed = failedAt === step.id;

          return (
            <li key={step.id} className="flex items-center gap-3">
              <span className="flex h-5 w-5 shrink-0 items-center justify-center">
                {isComplete ? (
                  <Check aria-hidden="true" className="h-4 w-4 text-success-700" />
                ) : isActive ? (
                  <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin text-brand-500" />
                ) : (
                  <span
                    className={cn(
                      'h-2 w-2 rounded-full',
                      isFailed ? 'bg-danger-600' : 'bg-grey-100',
                    )}
                  />
                )}
              </span>
              <span
                className={cn(
                  'text-body',
                  isComplete || isActive ? 'text-grey-900' : 'text-grey-300',
                  isFailed && 'text-danger-700',
                )}
              >
                {step.label}
              </span>
            </li>
          );
        })}
      </ol>

      {failedAt ? (
        <div className="flex flex-col gap-3">
          <p role="alert" className="text-body text-danger-700">
            {errorMessage}
          </p>
          {onRetry && (
            <button
              type="button"
              onClick={onRetry}
              className="self-start rounded-btn bg-brand-500 px-4 py-2 text-body text-white hover:bg-brand-600"
            >
              Try again in a few minutes
            </button>
          )}
        </div>
      ) : (
        <p className="text-caption text-grey-400">
          This usually takes under 30 seconds · {elapsed}s elapsed
        </p>
      )}
    </div>
  );
}
