/**
 * Which page the reader is actually looking at (spec 07 v1.1 5d-2b, L7).
 *
 * The viewers observe pages with a generous `rootMargin` so canvases are drawn
 * BEFORE they scroll into view. That is right for rendering and wrong for the
 * "Page X of N" indicator: under a 200% margin, pages two screens away are
 * "intersecting" too, so an indicator driven by observer callbacks reports
 * whichever entry happened to fire last. Live, that showed "Page 3 of 8" while
 * clause 10 on page 5 filled the viewport.
 *
 * The indicator is a geometry question, not an event question, so it is
 * answered by measuring.
 */

export interface PageBox {
  page: number;
  /** Viewport-relative edges, as `getBoundingClientRect` reports them. */
  top: number;
  bottom: number;
}

/**
 * The page covering the largest slice of the viewport, or `null` when none of
 * them is on screen. A tie resolves to the LOWER page number: when two pages
 * split the viewport evenly the reader has not finished the first one.
 */
export function dominantPage(viewportTop: number, viewportBottom: number, pages: PageBox[]): number | null {
  let best: number | null = null;
  let bestVisible = 0;

  for (const box of pages) {
    const visible = Math.min(box.bottom, viewportBottom) - Math.max(box.top, viewportTop);
    if (visible <= 0) continue;
    // Strictly greater, so an equal slice leaves the earlier page in place.
    if (visible > bestVisible || (visible === bestVisible && best !== null && box.page < best)) {
      best = box.page;
      bestVisible = visible;
    }
  }

  return best;
}

/** Measures a scroll container and its page elements into `dominantPage` input. */
export function measureDominantPage(
  container: HTMLElement | null,
  pages: Map<number, HTMLElement>,
): number | null {
  if (!container) return null;
  const view = container.getBoundingClientRect();
  const boxes: PageBox[] = [];
  for (const [page, element] of pages) {
    const rect = element.getBoundingClientRect();
    boxes.push({ page, top: rect.top, bottom: rect.bottom });
  }
  boxes.sort((a, b) => a.page - b.page);
  return dominantPage(view.top, view.bottom, boxes);
}
