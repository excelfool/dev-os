'use client';

import { Capability } from '@/components/layout/Capability';
import { useReviewMode } from '@/hooks/use-review-mode';

/**
 * The Review switch in the results header (spec 22 §4, spec 07 v1.1 §E).
 *
 * Wrapped in `<Capability>`: invisible while `eval.hhh_human` is `planned`,
 * and rendered with its note while `stub` — the scores save today, the sheet
 * export that turns them into a deliverable is Stage 7 (D53).
 */
export function ReviewModeToggle() {
  const review = useReviewMode();
  if (!review) return null;

  return (
    <Capability
      capability="eval.hhh_human"
      stub="children"
      stubNote="Scores are saved; the evaluation-sheet export arrives in Stage 7."
    >
      <button
        type="button"
        role="switch"
        aria-checked={review.reviewMode}
        onClick={() => review.setReviewMode(!review.reviewMode)}
        className={`rounded-badge px-2 py-0.5 text-caption ${
          review.reviewMode ? 'bg-brand-50 text-brand-700' : 'bg-grey-50 text-grey-500'
        }`}
      >
        Review
      </button>
    </Capability>
  );
}
