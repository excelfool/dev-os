'use client';

import { useEffect, useMemo, useRef } from 'react';
import { splitPages } from '@/lib/pdf/page-utils';
import { normalise } from '@/lib/utils/normalise-text';
import { scrollPageIntoView } from '@/hooks/use-target-page';
import type { DocumentViewerProps } from './types';

/**
 * A first-class alternative to the PDF canvas, not a degraded mode (spec 07
 * §2). It is also the recommended surface for screen-reader users.
 */
export function TextViewer({
  contractText,
  pdfPurgedAt,
  targetPage,
  highlight,
  nonce,
}: DocumentViewerProps & { contractText: string; pdfPurgedAt?: string | null }) {
  const pages = useMemo(() => splitPages(contractText), [contractText]);
  const pageRefs = useRef<Map<number, HTMLElement>>(new Map());

  useEffect(() => {
    if (targetPage === null) return;
    const element = pageRefs.current.get(targetPage);
    if (element) scrollPageIntoView(element);
  }, [targetPage, nonce]);

  return (
    <div
      // A scrollable region must be focusable, or a keyboard user cannot
      // scroll the contract text at all (WCAG 2.1.1).
      tabIndex={0}
      aria-label="Contract text"
      className="flex h-full flex-col overflow-y-auto"
    >
      {pdfPurgedAt && (
        <p className="sticky top-0 z-10 bg-warning-50 px-4 py-2 text-caption text-warning-900">
          The original PDF was removed after 90 days of inactivity. Your extracted text, key terms
          and chat history are unchanged.
        </p>
      )}

      {pages.map((page) => (
        <section
          key={page.page}
          aria-label={`Page ${page.page}`}
          ref={(el) => {
            if (el) pageRefs.current.set(page.page, el);
          }}
          className="border-b border-grey-50"
        >
          <h3 className="sticky top-0 bg-grey-25 px-4 py-2 text-caption text-grey-400">
            Page {page.page}
          </h3>
          <div className="whitespace-pre-wrap px-4 py-3 text-body text-grey-900">
            {renderWithHighlight(page.body, highlight?.page === page.page ? highlight.text : null, nonce)}
          </div>
        </section>
      ))}
    </div>
  );
}

/**
 * Marks the source sentence inside a page body. Matching is done on normalised
 * text so a sentence broken across lines still highlights, while the original
 * text is what gets rendered.
 */
function renderWithHighlight(body: string, needle: string | null, nonce: number) {
  if (!needle) return body;

  const normalisedNeedle = normalise(needle);
  if (normalisedNeedle.length === 0) return body;

  // Walk the body building a normalised projection with an index map back to
  // the original offsets, so the mark lands on the real characters.
  const map: number[] = [];
  let projected = '';
  let lastWasSpace = false;

  for (let i = 0; i < body.length; i += 1) {
    const char = body[i]!;
    if (/\s/.test(char)) {
      if (!lastWasSpace && projected.length > 0) {
        projected += ' ';
        map.push(i);
        lastWasSpace = true;
      }
      continue;
    }
    lastWasSpace = false;
    projected += char.toLowerCase();
    map.push(i);
  }

  const at = projected.indexOf(normalisedNeedle);
  if (at === -1) return body;

  const start = map[at] ?? 0;
  const end = (map[at + normalisedNeedle.length - 1] ?? body.length - 1) + 1;

  return (
    <>
      {body.slice(0, start)}
      <mark key={nonce} className="highlight-flash bg-warning-100">
        {body.slice(start, end)}
      </mark>
      {body.slice(end)}
    </>
  );
}
