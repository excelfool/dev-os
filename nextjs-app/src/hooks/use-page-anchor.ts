'use client';

import { useCallback, useEffect, useRef } from 'react';
import { scrollPageIntoView } from '@/hooks/use-target-page';

/**
 * L16: keeps a citation navigation on its page while the PDF is still
 * rendering. A page chip clicked before PDF.js has drawn the pages scrolls to
 * a 200 px placeholder; when the canvases land every page grows (≈ 885 px at
 * 1.2×) and the target slides out of view. The viewer calls `reanchor()` after
 * each page renders, which jumps back to the latest target — unless the reader
 * has scrolled since that target was set, in which case their position wins.
 *
 * "The reader scrolled" is read from input (wheel, touch, scroll keys, a press
 * inside the pane such as a scrollbar drag), not from `scroll` events: the
 * programmatic scroll fires those too and cannot be told apart.
 */
const SCROLL_KEYS = new Set(['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' ']);

export function usePageAnchor(
  containerRef: React.RefObject<HTMLElement>,
  pageRefs: React.RefObject<Map<number, HTMLElement>>,
) {
  const target = useRef<number | null>(null);
  const readerScrolled = useRef(false);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const release = () => {
      readerScrolled.current = true;
    };
    const onKey = (event: KeyboardEvent) => {
      if (SCROLL_KEYS.has(event.key)) release();
    };
    const events = ['wheel', 'touchmove', 'pointerdown'] as const;
    for (const type of events) container.addEventListener(type, release, { passive: true });
    container.addEventListener('keydown', onKey);
    return () => {
      for (const type of events) container.removeEventListener(type, release);
      container.removeEventListener('keydown', onKey);
    };
  }, [containerRef]);

  /** A navigation: remember it and scroll to it (smoothly, per reduced-motion). */
  const aim = useCallback(
    (page: number) => {
      const host = pageRefs.current?.get(page);
      if (!host) return;
      target.current = page;
      readerScrolled.current = false;
      scrollPageIntoView(host);
    },
    [pageRefs],
  );

  /** After a page renders: jump back to the latest target, if the reader has not moved. */
  const reanchor = useCallback(() => {
    if (target.current === null || readerScrolled.current) return;
    pageRefs.current?.get(target.current)?.scrollIntoView({ behavior: 'auto', block: 'start' });
  }, [pageRefs]);

  return { aim, reanchor };
}
