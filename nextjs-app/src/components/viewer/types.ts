import type { Highlight } from '@/hooks/use-target-page';

/**
 * Both viewers implement this identical contract, so the rest of the app never
 * branches on which one is mounted (spec 07 §2).
 */
export interface DocumentViewerProps {
  pageCount: number;
  targetPage: number | null;
  highlight: Highlight | null;
  /** Bumped per navigation so repeat clicks on the same page re-flash. */
  nonce: number;
  onPageVisible?: (page: number) => void;
}
