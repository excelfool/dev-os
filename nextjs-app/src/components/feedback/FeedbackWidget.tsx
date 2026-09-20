'use client';

import { useState } from 'react';
import { ThumbsDown, ThumbsUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils/cn';
import type { Rating, SurveyAccuracy } from '@/types/domain';

const SURVEY_OPTIONS: Array<{ value: SurveyAccuracy; label: string }> = [
  { value: 'yes', label: 'Yes' },
  { value: 'partially', label: 'Partially' },
  { value: 'no', label: 'No' },
];

/** US-010, FR-12 (spec 10 §2). The row is upserted, so it stays editable. */
export function FeedbackWidget({
  contractId,
  initialRating,
  initialSurvey,
  betaSurveyEnabled = true,
}: {
  contractId: string;
  initialRating?: Rating | null;
  initialSurvey?: SurveyAccuracy | null;
  betaSurveyEnabled?: boolean;
}) {
  const [rating, setRating] = useState<Rating | null>(initialRating ?? null);
  const [survey, setSurvey] = useState<SurveyAccuracy | null>(initialSurvey ?? null);
  const [comment, setComment] = useState('');
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(next: { rating: Rating; survey?: SurveyAccuracy | null }) {
    setError(null);
    const res = await fetch('/api/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contract_id: contractId,
        rating: next.rating,
        comment: comment.trim() || undefined,
        survey_accuracy: next.survey ?? survey ?? undefined,
      }),
    });

    if (!res.ok) {
      const body = await res.json().catch(() => null);
      setError(body?.error?.message ?? 'Could not save your feedback.');
      return;
    }
    setSaved(true);
  }

  return (
    <section className="flex flex-col gap-3 rounded-card border border-grey-100 p-4" aria-label="Feedback">
      <h3 className="text-body text-grey-900">Was this review accurate?</h3>

      <div className="flex gap-2">
        <Button
          variant={rating === 'up' ? 'primary' : 'secondary'}
          size="sm"
          aria-label="This review was accurate"
          aria-pressed={rating === 'up'}
          onClick={() => {
            setRating('up');
            void submit({ rating: 'up' });
          }}
        >
          <ThumbsUp aria-hidden="true" className="h-4 w-4" />
        </Button>
        <Button
          variant={rating === 'down' ? 'primary' : 'secondary'}
          size="sm"
          aria-label="This review was not accurate"
          aria-pressed={rating === 'down'}
          onClick={() => {
            setRating('down');
            void submit({ rating: 'down' });
          }}
        >
          <ThumbsDown aria-hidden="true" className="h-4 w-4" />
        </Button>
      </div>

      {/* The comment field appears only after a rating is chosen. */}
      {rating && (
        <>
          <label htmlFor="feedback-comment" className="sr-only-live">
            Anything we got wrong?
          </label>
          <textarea
            id="feedback-comment"
            rows={2}
            maxLength={1000}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            onBlur={() => rating && void submit({ rating })}
            placeholder="Anything we got wrong? (optional)"
            className="rounded-input border border-grey-200 px-3 py-2 text-body text-grey-900 placeholder:text-grey-300"
          />

          {betaSurveyEnabled && (
            <fieldset className="flex flex-col gap-2">
              <legend className="text-caption text-grey-500">
                Were the extracted terms accurate?
              </legend>
              <div className="flex gap-2">
                {SURVEY_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    aria-pressed={survey === option.value}
                    onClick={() => {
                      setSurvey(option.value);
                      void submit({ rating, survey: option.value });
                    }}
                    className={cn(
                      'rounded-btn border px-3 py-1.5 text-caption',
                      survey === option.value
                        ? 'border-brand-500 bg-brand-50 text-brand-700'
                        : 'border-grey-200 text-grey-600',
                    )}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </fieldset>
          )}
        </>
      )}

      {saved && <p className="text-caption text-grey-400">Thanks — this helps us improve.</p>}
      {error && (
        <p role="alert" className="text-caption text-danger-700">
          {error}
        </p>
      )}
    </section>
  );
}
