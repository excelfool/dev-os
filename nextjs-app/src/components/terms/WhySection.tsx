'use client';

/**
 * The "Why?" disclosure (spec 07 §C as amended by 5d-2a, FR-04): the verbatim
 * sentence the model anchored on, with its page and the unverified-source
 * warning.
 *
 * The **Reasoning** block used to live here too. 5d-2a moved it into the row
 * itself: PRD R-16 wants the answer, the citation and the reasoning shown
 * together, and reasoning behind a disclosure is reasoning most users never
 * read. The quoted source stays here — it is the long, verbatim artefact a
 * reader opens deliberately.
 *
 * The block is a `group` with an accessible name so it is distinguishable to a
 * screen reader rather than reading as one run of text.
 */
export function WhySection({
  sourceSentence,
  pageNumber,
  isSourceVerified,
}: {
  sourceSentence: string | null;
  pageNumber: number | null;
  isSourceVerified: boolean;
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

    </div>
  );
}
