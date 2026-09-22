'use client';

import { createContext, createElement, useCallback, useContext, useMemo, useState } from 'react';

/**
 * Review mode (spec 22 §4, spec 07 v1.1 §E).
 *
 * One flag shared by the header toggle, the term rows, the summary card and
 * the chat bubbles, so every questionnaire appears and disappears together.
 * Review mode changes nothing else on the page and never touches `key_terms`.
 */
interface ReviewModeValue {
  reviewMode: boolean;
  setReviewMode: (on: boolean) => void;
  /** Terms the reviewer has saved at least one answer set for. */
  scoredTermIds: Set<string>;
  markTermScored: (termId: string) => void;
  /** Human rows this reviewer owns, across all their contracts. */
  humanRowCount: number;
  setHumanRowCount: (n: number) => void;
}

const ReviewModeContext = createContext<ReviewModeValue | null>(null);

export function ReviewModeProvider({
  children,
  initialOn = false,
  initialHumanRowCount = 0,
  initialScoredTermIds = [],
}: {
  children: React.ReactNode;
  /** `?mode=review` turns it on without a click. */
  initialOn?: boolean;
  initialHumanRowCount?: number;
  initialScoredTermIds?: string[];
}) {
  const [reviewMode, setReviewMode] = useState(initialOn);
  const [scored, setScored] = useState<Set<string>>(() => new Set(initialScoredTermIds));
  const [humanRowCount, setHumanRowCount] = useState(initialHumanRowCount);

  const markTermScored = useCallback((termId: string) => {
    setScored((previous) => {
      if (previous.has(termId)) return previous;
      const next = new Set(previous);
      next.add(termId);
      return next;
    });
  }, []);

  const value = useMemo(
    () => ({
      reviewMode,
      setReviewMode,
      scoredTermIds: scored,
      markTermScored,
      humanRowCount,
      setHumanRowCount,
    }),
    [reviewMode, scored, markTermScored, humanRowCount],
  );

  return createElement(ReviewModeContext.Provider, { value }, children);
}

/** Null outside the provider, so a component can render without review mode. */
export function useReviewMode(): ReviewModeValue | null {
  return useContext(ReviewModeContext);
}
