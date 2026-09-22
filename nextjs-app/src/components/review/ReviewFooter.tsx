'use client';

import { useReviewMode } from '@/hooks/use-review-mode';

/**
 * The sticky Review-mode footer (spec 22 §4).
 *
 * The totals are what RLS lets this reviewer read — their own human rows.
 * There is no cross-tenant count here and there could not be one.
 */
export function ReviewFooter({ termCount }: { termCount: number }) {
  const review = useReviewMode();
  if (!review?.reviewMode) return null;

  const scored = review.scoredTermIds.size;
  return (
    <div className="sticky bottom-0 z-10 border-t border-grey-100 bg-grey-25 px-4 py-2 text-caption text-grey-600">
      Scored {scored} of {termCount} terms on this contract · {review.humanRowCount} human rows total
    </div>
  );
}
