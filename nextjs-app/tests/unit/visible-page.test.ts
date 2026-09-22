import { describe, expect, it } from 'vitest';
import { dominantPage, type PageBox } from '@/lib/viewer/visible-page';

/**
 * L7 (spec 07 v1.1 5d-2b). The indicator used to follow whichever
 * IntersectionObserver entry fired last, under a 200% rootMargin that exists
 * for lazy RENDERING — so pages two screens away counted as "intersecting"
 * and the header could read "Page 3 of 8" while clause 10 on page 5 filled
 * the viewport. The indicator is now the page occupying the largest visible
 * area of the scroll container.
 */

/** Pages 1..n, each `height` tall, stacked from `top`. */
function stack(n: number, height = 100, top = 0): PageBox[] {
  return Array.from({ length: n }, (_, i) => ({
    page: i + 1,
    top: top + i * height,
    bottom: top + (i + 1) * height,
  }));
}

describe('dominantPage (L7)', () => {
  it('is the only page in view', () => {
    expect(dominantPage(0, 100, stack(8))).toBe(1);
  });

  it('is the page filling most of the viewport, not the first one touching it', () => {
    // Viewport 470–570: page 5 (400–500) shows 30px, page 6 (500–600) shows 70px.
    expect(dominantPage(470, 570, stack(8))).toBe(6);
  });

  it('resolves a tie to the lower page', () => {
    // Viewport 450–550: page 5 and page 6 each show 50px.
    expect(dominantPage(450, 550, stack(8))).toBe(5);
  });

  it('ignores pages scrolled far above the viewport', () => {
    // The old observer counted these because of the 200% rootMargin.
    expect(dominantPage(700, 800, stack(8))).toBe(8);
  });

  it('is the middle page when a tall viewport spans three', () => {
    // Viewport 190–410: page 2 shows 10, page 3 shows 100, page 4 shows 10.
    expect(dominantPage(190, 410, stack(8))).toBe(3);
  });

  it('is null when nothing is visible', () => {
    expect(dominantPage(2_000, 2_100, stack(8))).toBeNull();
  });

  it('is null for an empty document', () => {
    expect(dominantPage(0, 100, [])).toBeNull();
  });

  it('handles pages of unequal height', () => {
    const pages: PageBox[] = [
      { page: 1, top: 0, bottom: 50 },
      { page: 2, top: 50, bottom: 450 },
      { page: 3, top: 450, bottom: 500 },
    ];
    expect(dominantPage(0, 200, pages)).toBe(2);
  });

  it('counts only the visible slice of a page taller than the viewport', () => {
    const pages: PageBox[] = [
      { page: 1, top: -900, bottom: 100 },
      { page: 2, top: 100, bottom: 1_100 },
    ];
    // Viewport 0–200: page 1 shows 100, page 2 shows 100 — tie, lower wins.
    expect(dominantPage(0, 200, pages)).toBe(1);
  });
});
