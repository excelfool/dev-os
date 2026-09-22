'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Minus, Plus, Maximize2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { scrollPageIntoView } from '@/hooks/use-target-page';
import { useVisiblePage } from '@/hooks/use-visible-page';
import type { DocumentViewerProps } from './types';

/**
 * PDF.js viewer (spec 07 §2).
 *
 * The worker is served from /pdf.worker.min.mjs — never a CDN, so no contract
 * bytes leave the origin. Pages render lazily: only pages in and adjacent to
 * the viewport are drawn to canvas, which is the stated mitigation for
 * large-file memory pressure.
 */
const SIGNED_URL_REFRESH_MS = 55 * 60 * 1000;
const ZOOM_STEP = 0.25;
const MIN_SCALE = 0.5;
const MAX_SCALE = 3;

export function PdfViewer({
  contractId,
  pageCount,
  targetPage,
  nonce,
  onRenderFailure,
}: DocumentViewerProps & { contractId: string; onRenderFailure: (reason: string) => void }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const pageRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const docRef = useRef<{ getPage: (n: number) => Promise<unknown>; destroy?: () => void } | null>(null);
  const renderedRef = useRef<Set<number>>(new Set());

  const [scale, setScale] = useState(1.2);
  const [isReady, setIsReady] = useState(false);

  // L7: the indicator is measured, not inferred from the lazy-render observer
  // below — that one deliberately fires for pages far outside the viewport.
  const currentPage = useVisiblePage(containerRef, pageRefs, targetPage, nonce);

  const loadDocument = useCallback(async () => {
    const res = await fetch(`/api/contracts/${contractId}/signed-url`, { method: 'POST' });
    if (!res.ok) {
      // 404 NO_FILE is the expected state after a purge or Storage failure —
      // the parent falls back to the text viewer silently, not as an error.
      const body = await res.json().catch(() => null);
      throw new Error(body?.error?.code === 'NO_FILE' ? 'NO_FILE' : 'SIGNED_URL_FAILED');
    }
    const { url } = await res.json();

    const pdfjs = await import('pdfjs-dist');
    pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';
    const task = pdfjs.getDocument({ url });
    return task.promise;
  }, [contractId]);

  useEffect(() => {
    let cancelled = false;

    async function boot() {
      try {
        const doc = await loadDocument();
        if (cancelled) return;
        docRef.current = doc as never;
        setIsReady(true);
      } catch (err) {
        if (!cancelled) onRenderFailure(err instanceof Error ? err.message : 'RENDER_FAILED');
      }
    }

    void boot();
    const refresh = setInterval(() => void boot(), SIGNED_URL_REFRESH_MS);

    return () => {
      cancelled = true;
      clearInterval(refresh);
    };
  }, [loadDocument, onRenderFailure]);

  const renderPage = useCallback(
    async (pageNumber: number) => {
      const doc = docRef.current;
      const host = pageRefs.current.get(pageNumber);
      if (!doc || !host) return;

      const key = pageNumber;
      if (renderedRef.current.has(key)) return;
      renderedRef.current.add(key);

      try {
        const page = (await doc.getPage(pageNumber)) as {
          getViewport: (o: { scale: number }) => { width: number; height: number };
          render: (o: Record<string, unknown>) => { promise: Promise<void> };
        };
        const viewport = page.getViewport({ scale });
        const canvas = document.createElement('canvas');
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        canvas.className = 'w-full shadow-sm';
        const context = canvas.getContext('2d');
        if (!context) throw new Error('canvas unavailable');

        await page.render({ canvasContext: context, viewport }).promise;
        host.replaceChildren(canvas);
      } catch (err) {
        renderedRef.current.delete(key);
        onRenderFailure(err instanceof Error ? err.message : 'RENDER_FAILED');
      }
    },
    [scale, onRenderFailure],
  );

  // Lazy rendering: draw a page when it approaches the viewport.
  useEffect(() => {
    if (!isReady) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const pageNumber = Number((entry.target as HTMLElement).dataset.page);
          // Rendering only. The 200% margin means "isIntersecting" here covers
          // roughly five screens, which is why it must not set the indicator.
          if (entry.isIntersecting) void renderPage(pageNumber);
        }
      },
      { root: containerRef.current, rootMargin: '200% 0px' },
    );

    for (const host of pageRefs.current.values()) observer.observe(host);
    return () => observer.disconnect();
  }, [isReady, renderPage]);

  // A zoom change invalidates every rendered canvas.
  useEffect(() => {
    renderedRef.current.clear();
    if (isReady) void renderPage(currentPage);
  }, [scale, isReady, renderPage, currentPage]);

  useEffect(() => {
    if (targetPage === null) return;
    const host = pageRefs.current.get(targetPage);
    if (host) {
      void renderPage(targetPage);
      scrollPageIntoView(host);
    }
  }, [targetPage, nonce, renderPage]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between gap-2 border-b border-grey-50 px-3 py-2">
        <span className="text-caption text-grey-400">
          Page {currentPage} of {pageCount}
        </span>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            aria-label="Zoom out"
            onClick={() => setScale((s) => Math.max(MIN_SCALE, s - ZOOM_STEP))}
          >
            <Minus aria-hidden="true" className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="sm" aria-label="Fit width" onClick={() => setScale(1.2)}>
            <Maximize2 aria-hidden="true" className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            aria-label="Zoom in"
            onClick={() => setScale((s) => Math.min(MAX_SCALE, s + ZOOM_STEP))}
          >
            <Plus aria-hidden="true" className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div
        ref={containerRef}
        tabIndex={0}
        onKeyDown={(event) => {
          if (event.key === '+' || event.key === '=') setScale((s) => Math.min(MAX_SCALE, s + ZOOM_STEP));
          if (event.key === '-') setScale((s) => Math.max(MIN_SCALE, s - ZOOM_STEP));
          if (event.key === '0') setScale(1.2);
        }}
        className="flex-1 overflow-y-auto bg-grey-25 p-3"
      >
        {Array.from({ length: pageCount }, (_, index) => index + 1).map((pageNumber) => (
          <div key={pageNumber} className="mb-3">
            <div className="mb-1 text-caption text-grey-400">Page {pageNumber}</div>
            <div
              data-page={pageNumber}
              ref={(el) => {
                if (el) pageRefs.current.set(pageNumber, el);
              }}
              className="min-h-[200px] w-full bg-white"
            />
          </div>
        ))}
      </div>
    </div>
  );
}
