'use client';

import { useEffect, useState } from 'react';
import { measureDominantPage } from '@/lib/viewer/visible-page';

/**
 * Drives the "Page X of N" indicator in both viewers (spec 07 v1.1 5d-2b, L7).
 *
 * Two inputs, in this order of authority:
 *
 * 1. **Programmatic navigation.** `goToPage(5)` means the reader asked for
 *    page 5, so the indicator says 5 immediately — it does not wait for a
 *    smooth scroll to settle, and does not flicker through the pages passed on
 *    the way.
 * 2. **Scrolling.** Otherwise it is whichever page covers most of the
 *    container, remeasured on scroll and on resize.
 *
 * Measurement is deliberately not driven by the IntersectionObserver the
 * viewers use for lazy rendering: that observer runs with a large `rootMargin`
 * and reports pages that are nowhere near the viewport.
 */
export function useVisiblePage(
  containerRef: React.RefObject<HTMLElement>,
  pageRefs: React.RefObject<Map<number, HTMLElement>>,
  targetPage: number | null,
  nonce: number,
): number {
  const [currentPage, setCurrentPage] = useState(1);

  // A navigation answers the question on its own.
  useEffect(() => {
    if (targetPage !== null) setCurrentPage(targetPage);
  }, [targetPage, nonce]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const remeasure = () => {
      const page = measureDominantPage(container, pageRefs.current ?? new Map());
      // `null` means nothing is on screen (mid-relayout, or a container with
      // no height yet). Keep the last known page rather than snapping to 1.
      if (page !== null) setCurrentPage(page);
    };

    let frame = 0;
    const onScroll = () => {
      // Coalesce to one measurement per frame: scroll fires far faster than
      // layout changes, and each measurement reads every page's rect.
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        remeasure();
      });
    };

    container.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    remeasure();

    return () => {
      if (frame) cancelAnimationFrame(frame);
      container.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
    };
  }, [containerRef, pageRefs]);

  return currentPage;
}
