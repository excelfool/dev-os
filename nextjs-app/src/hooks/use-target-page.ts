'use client';

import { createContext, createElement, useCallback, useContext, useMemo, useState } from 'react';

/**
 * Page navigation shared by the terms panel, the chat citations and the
 * viewers (spec 07 §3). One `targetPage` contract, so the rest of the app never
 * branches on which viewer is mounted.
 */
export interface Highlight {
  page: number;
  text: string;
}

interface TargetPageValue {
  targetPage: number | null;
  highlight: Highlight | null;
  goToPage: (page: number, text?: string | null) => void;
  /** Bumped on every call so repeat navigation to the same page re-flashes. */
  nonce: number;
}

const TargetPageContext = createContext<TargetPageValue | null>(null);

export function TargetPageProvider({ children }: { children: React.ReactNode }) {
  const [targetPage, setTargetPage] = useState<number | null>(null);
  const [highlight, setHighlight] = useState<Highlight | null>(null);
  const [nonce, setNonce] = useState(0);

  const goToPage = useCallback((page: number, text?: string | null) => {
    setTargetPage(page);
    setHighlight(text ? { page, text } : null);
    setNonce((n) => n + 1);
  }, []);

  const value = useMemo(
    () => ({ targetPage, highlight, goToPage, nonce }),
    [targetPage, highlight, goToPage, nonce],
  );

  return createElement(TargetPageContext.Provider, { value }, children);
}

export function useTargetPage(): TargetPageValue {
  const context = useContext(TargetPageContext);
  if (!context) throw new Error('useTargetPage must be used inside TargetPageProvider');
  return context;
}

/** Honours prefers-reduced-motion by jumping instead of smooth-scrolling. */
export function scrollPageIntoView(element: HTMLElement): void {
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  element.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' });
}
