'use client';

import { useTargetPage } from '@/hooks/use-target-page';

/** "Source: Page X" — calls the same goToPage the terms panel uses. */
export function PageCitationChip({ page }: { page: number }) {
  const { goToPage } = useTargetPage();

  return (
    <button
      type="button"
      onClick={() => goToPage(page)}
      className="rounded-badge bg-grey-50 px-2 py-0.5 text-caption text-grey-600 hover:bg-grey-100"
    >
      Source: Page {page}
    </button>
  );
}
