// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, renderHook } from '@testing-library/react';
import { usePageAnchor } from '@/hooks/use-page-anchor';

/**
 * L16. A page chip clicked before PDF.js has drawn the pages scrolls to a
 * 200 px placeholder; when the canvases land (≈ 885 px each) the target slides
 * out of view. jsdom does no layout, so the layout is modelled explicitly:
 * stacked pages with mutable heights, and a scrollIntoView that scrolls the
 * pane to the page's current offset — which is all the browser does.
 */

const PLACEHOLDER = 200;
const RENDERED = 885;
const PANE_HEIGHT = 457;

function makeViewer(count: number) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const heights = new Map<number, number>();
  const pages = new Map<number, HTMLElement>();
  const state = { scrollTop: 0 };
  const offsetOf = (page: number) => {
    let top = 0;
    for (let p = 1; p < page; p += 1) top += heights.get(p)!;
    return top;
  };

  for (let page = 1; page <= count; page += 1) {
    heights.set(page, PLACEHOLDER);
    const element = document.createElement('div');
    element.scrollIntoView = () => {
      state.scrollTop = offsetOf(page);
    };
    container.appendChild(element);
    pages.set(page, element);
  }

  return {
    containerRef: { current: container },
    pageRefs: { current: pages },
    /** PDF.js drew page `page`: it grows to canvas height. Scroll position is untouched, as in a browser. */
    render(page: number) {
      heights.set(page, RENDERED);
    },
    /** The page's top relative to the pane; 0 means it is at the top of the view. */
    topInPane(page: number) {
      return offsetOf(page) - state.scrollTop;
    },
    isInView(page: number) {
      const top = offsetOf(page) - state.scrollTop;
      return top < PANE_HEIGHT && top + heights.get(page)! > 0;
    },
  };
}

beforeEach(() => {
  window.matchMedia = vi.fn().mockReturnValue({ matches: false }) as never;
});
afterEach(() => {
  cleanup();
  document.body.innerHTML = '';
});

describe('usePageAnchor (L16)', () => {
  it('a target set over placeholders is still on screen after every page renders', () => {
    const viewer = makeViewer(3);
    const { result } = renderHook(() => usePageAnchor(viewer.containerRef, viewer.pageRefs));

    result.current.aim(3);
    expect(viewer.topInPane(3)).toBe(0);

    // The canvases land, each followed by the viewer's reanchor() call.
    for (const page of [1, 2, 3]) {
      viewer.render(page);
      result.current.reanchor();
    }

    expect(viewer.topInPane(3)).toBe(0);
    expect(viewer.isInView(3)).toBe(true);
  });

  it('without the re-anchor the same sequence loses the target (the bug)', () => {
    const viewer = makeViewer(3);
    const { result } = renderHook(() => usePageAnchor(viewer.containerRef, viewer.pageRefs));

    result.current.aim(3);
    for (const page of [1, 2, 3]) viewer.render(page);

    expect(viewer.isInView(3)).toBe(false);
  });

  it.each([
    ['a wheel scroll', () => new WheelEvent('wheel')],
    ['a touch scroll', () => new Event('touchmove')],
    ['a scrollbar drag', () => new Event('pointerdown')],
    ['a scroll key', () => new KeyboardEvent('keydown', { key: 'PageDown' })],
  ])('%s after the target is set cancels the re-scroll', (_label, makeEvent) => {
    const viewer = makeViewer(3);
    const { result } = renderHook(() => usePageAnchor(viewer.containerRef, viewer.pageRefs));

    result.current.aim(3);
    const readerPosition = viewer.topInPane(3);
    viewer.containerRef.current.dispatchEvent(makeEvent());

    for (const page of [1, 2, 3]) {
      viewer.render(page);
      result.current.reanchor();
    }

    // No jump: the pages grew under a scroll position the reader now owns.
    expect(viewer.topInPane(3)).toBe(readerPosition + 2 * (RENDERED - PLACEHOLDER));
  });

  it('a new navigation after a reader scroll re-arms the anchor', () => {
    const viewer = makeViewer(3);
    const { result } = renderHook(() => usePageAnchor(viewer.containerRef, viewer.pageRefs));

    result.current.aim(2);
    viewer.containerRef.current.dispatchEvent(new WheelEvent('wheel'));
    result.current.aim(3);

    for (const page of [1, 2, 3]) {
      viewer.render(page);
      result.current.reanchor();
    }
    expect(viewer.topInPane(3)).toBe(0);
  });

  it('a non-scroll key (a zoom shortcut) does not cancel the re-scroll', () => {
    const viewer = makeViewer(3);
    const { result } = renderHook(() => usePageAnchor(viewer.containerRef, viewer.pageRefs));

    result.current.aim(3);
    viewer.containerRef.current.dispatchEvent(new KeyboardEvent('keydown', { key: '+' }));
    viewer.render(1);
    result.current.reanchor();
    expect(viewer.topInPane(3)).toBe(0);
  });

  it('reanchor before any navigation does nothing', () => {
    const viewer = makeViewer(3);
    const { result } = renderHook(() => usePageAnchor(viewer.containerRef, viewer.pageRefs));
    viewer.render(1);
    result.current.reanchor();
    expect(viewer.topInPane(1)).toBe(0);
  });
});
