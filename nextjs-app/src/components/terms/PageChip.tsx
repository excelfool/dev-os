'use client';

import { InfoTooltip } from '@/components/ui/tooltip';
import { useTargetPage } from '@/hooks/use-target-page';

/**
 * "Page {n}" button (FR-07, US-003). Rendered as inert text when the model
 * returned no page reference. v1.1 §D adds the optional edit pencil and the
 * "Page edited" tag.
 */
export function PageChip({
  pageNumber,
  sourceSentence,
  editor,
  edited = false,
}: {
  pageNumber: number | null;
  sourceSentence: string | null;
  /**
   * Spec 07 v1.1 §D: the pencil that opens the page editor. A slot rather than
   * a built-in, because the chip is also used read-only by `KeyDatesCard`.
   */
  editor?: React.ReactNode;
  /** Shows the "Page edited" tag beside the chip. */
  edited?: boolean;
}) {
  const { goToPage } = useTargetPage();

  return (
    <span className="inline-flex items-center gap-1">
      {pageNumber === null ? (
        <span className="text-caption text-grey-300" aria-label="No page reference">
          —
        </span>
      ) : (
        <button
          type="button"
          onClick={() => goToPage(pageNumber, sourceSentence)}
          className="rounded-badge bg-grey-50 px-2 py-0.5 text-caption text-grey-600 hover:bg-grey-100"
        >
          Page {pageNumber}
        </button>
      )}
      {edited && (
        <InfoTooltip label="You changed this. The original AI page is kept for accuracy tracking.">
          <span className="rounded-badge bg-grey-50 px-1.5 py-0.5 text-caption text-grey-500">
            Page edited
          </span>
        </InfoTooltip>
      )}
      {editor}
    </span>
  );
}
