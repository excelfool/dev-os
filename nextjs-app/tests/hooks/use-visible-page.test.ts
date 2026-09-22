// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import { useVisiblePage } from '@/hooks/use-visible-page';

/**
 * L7 (spec 07 v1.1 5d-2b): the "Page X of N" indicator. jsdom does no layout,
 * so every rect is stated explicitly — which is the point: these assert the
 * rule ("the page covering most of the container"), not the browser.
 */

const VIEWPORT = { top: 0, bottom: 600 };
const PAGE_HEIGHT = 500;

/** A container plus `count` stacked pages, scrolled to `scrollTop`. */
function makeViewer(count: number, scrollTop = 0) {
  const container = document.createElement('div');
  container.getBoundingClientRect = () => ({ ...VIEWPORT, height: 600, left: 0, right: 0, width: 0, x: 0, y: 0, toJSON: () => ({}) });

  const pages = new Map<number, HTMLElement>();
  const state = { scrollTop };

  for (let page = 1; page <= count; page += 1) {
    const element = document.createElement('div');
    element.getBoundingClientRect = () => {
      const top = (page - 1) * PAGE_HEIGHT - state.scrollTop;
      return { top, bottom: top + PAGE_HEIGHT, height: PAGE_HEIGHT, left: 0, right: 0, width: 0, x: 0, y: top, toJSON: () => ({}) };
    };
    pages.set(page, element);
  }

  return {
    containerRef: { current: container },
    pageRefs: { current: pages },
    /** Moves the scroll position and fires the event the hook listens for. */
    scrollTo(next: number) {
      state.scrollTop = next;
      container.dispatchEvent(new Event('scroll'));
    },
  };
}

beforeEach(() => {
  // Run the hook's coalescing frame synchronously.
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    cb(0);
    return 1;
  });
  vi.stubGlobal('cancelAnimationFrame', () => undefined);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('useVisiblePage (L7)', () => {
  it('starts on the page at the top of the document', () => {
    const viewer = makeViewer(8);

    const { result } = renderHook(() => useVisiblePage(viewer.containerRef, viewer.pageRefs, null, 0));

    expect(result.current).toBe(1);
  });

  it('reports the targeted page immediately after goToPage', () => {
    const viewer = makeViewer(8);

    const { result, rerender } = renderHook(
      ({ target, nonce }) => useVisiblePage(viewer.containerRef, viewer.pageRefs, target, nonce),
      { initialProps: { target: null as number | null, nonce: 0 } },
    );

    rerender({ target: 5, nonce: 1 });

    expect(result.current).toBe(5);
  });

  it('re-reports the same page when the reader clicks the citation twice', () => {
    const viewer = makeViewer(8);

    const { result, rerender } = renderHook(
      ({ target, nonce }) => useVisiblePage(viewer.containerRef, viewer.pageRefs, target, nonce),
      { initialProps: { target: 5 as number | null, nonce: 1 } },
    );
    act(() => viewer.scrollTo(0)); // the reader scrolls away to page 1
    expect(result.current).toBe(1);

    rerender({ target: 5, nonce: 2 });

    expect(result.current).toBe(5);
  });

  it('follows the dominant page during manual scrolling', () => {
    const viewer = makeViewer(8);
    const { result } = renderHook(() => useVisiblePage(viewer.containerRef, viewer.pageRefs, null, 0));

    // Page 5 spans 2000–2500. Scrolled to 2100, the viewport is 2100–2700:
    // page 5 shows 400px, page 6 shows 200px.
    act(() => viewer.scrollTo(2_100));

    expect(result.current).toBe(5);
  });

  it('switches once the next page takes the larger share', () => {
    const viewer = makeViewer(8);
    const { result } = renderHook(() => useVisiblePage(viewer.containerRef, viewer.pageRefs, null, 0));

    // Viewport 2400–3000: page 5 shows 100px, page 6 shows 500px.
    act(() => viewer.scrollTo(2_400));

    expect(result.current).toBe(6);
  });

  it('does not report a page two screens away — the old lazy-render bug', () => {
    const viewer = makeViewer(8);
    const { result } = renderHook(() => useVisiblePage(viewer.containerRef, viewer.pageRefs, null, 0));

    // Page 5 fills the viewport; the render observer would also have fired for
    // pages 3 and 7 under its 200% margin.
    act(() => viewer.scrollTo(2_000));

    expect(result.current).toBe(5);
  });

  it('keeps the last known page when nothing measures on screen', () => {
    const viewer = makeViewer(8);
    const { result } = renderHook(() => useVisiblePage(viewer.containerRef, viewer.pageRefs, null, 0));
    act(() => viewer.scrollTo(2_000));
    expect(result.current).toBe(5);

    act(() => viewer.scrollTo(99_999));

    expect(result.current).toBe(5);
  });
});
