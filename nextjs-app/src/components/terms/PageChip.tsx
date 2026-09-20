'use client';

import { useTargetPage } from '@/hooks/use-target-page';

/**
 * "Page {n}" button (FR-07, US-003). Rendered as inert text when the model
 * returned no page reference.
 */
export function PageChip({
  pageNumber,
  sourceSentence,
}: {
  pageNumber: number | null;
  sourceSentence: string | null;
}) {
  const { goToPage } = useTargetPage();

  if (pageNumber === null) {
    return (
      <span className="text-caption text-grey-300" aria-label="No page reference">
        —
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={() => goToPage(pageNumber, sourceSentence)}
      className="rounded-badge bg-grey-50 px-2 py-0.5 text-caption text-grey-600 hover:bg-grey-100"
    >
      Page {pageNumber}
    </button>
  );
}
