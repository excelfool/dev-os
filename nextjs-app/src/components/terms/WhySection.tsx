'use client';

import { InfoTooltip } from '@/components/ui/tooltip';

/**
 * The "Why?" disclosure (spec 07 v1.1 §C, FR-04, R-16): two labelled blocks.
 *
 * **Source** is the verbatim sentence the model anchored on, with its page and
 * the unverified-source warning. **Reasoning** is the model's one-line account
 * of why that sentence answers the term's question, and is editable.
 *
 * Each block is a `group` with an accessible name, so the two are
 * distinguishable to a screen reader rather than reading as one run of text.
 */
export function WhySection({
  sourceSentence,
  pageNumber,
  isSourceVerified,
  reasoning,
  reasoningEdited = false,
  reasoningEditor,
}: {
  sourceSentence: string | null;
  pageNumber: number | null;
  isSourceVerified: boolean;
  reasoning: string | null;
  reasoningEdited?: boolean;
  /** Spec 07 v1.1 §D: the "Edit" control for the reasoning block. */
  reasoningEditor?: React.ReactNode;
}) {
  return (
    <div className="mt-2 flex flex-col gap-3 border-l-2 border-grey-100 pl-3">
      <section role="group" aria-label="Source" className="flex flex-col gap-1">
        <h4 className="text-caption font-medium text-grey-700">Source</h4>
        {sourceSentence ? (
          <>
            <blockquote className="text-body text-grey-600">&ldquo;{sourceSentence}&rdquo;</blockquote>
            {pageNumber !== null && (
              <p className="text-caption text-grey-400">Found on page {pageNumber}</p>
            )}
            {!isSourceVerified && (
              <p className="text-caption text-danger-700">
                We couldn&apos;t match this sentence to the document text — verify it directly.
              </p>
            )}
          </>
        ) : (
          <p className="text-caption text-grey-400">No supporting sentence was found for this term.</p>
        )}
      </section>

      <section role="group" aria-label="Reasoning" className="flex flex-col gap-1">
        <span className="flex items-center gap-2">
          <h4 className="text-caption font-medium text-grey-700">Reasoning</h4>
          {reasoningEdited && (
            <InfoTooltip label="You changed this. The original AI reasoning is kept for accuracy tracking.">
              <span className="rounded-badge bg-grey-50 px-1.5 py-0.5 text-caption text-grey-500">
                Reasoning edited
              </span>
            </InfoTooltip>
          )}
          {reasoningEditor}
        </span>
        {reasoning ? (
          <p className="text-body text-grey-600">{reasoning}</p>
        ) : (
          <p className="text-caption text-grey-400">No reasoning was returned for this term.</p>
        )}
      </section>
    </div>
  );
}
