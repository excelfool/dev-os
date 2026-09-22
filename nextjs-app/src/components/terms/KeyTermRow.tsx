'use client';

import { useEffect, useState } from 'react';
import { ChevronDown, Info } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { InfoTooltip } from '@/components/ui/tooltip';
import { ConfidenceBadge } from './ConfidenceBadge';
import { PageChip } from './PageChip';
import { WhySection } from './WhySection';
import { InlineTermEditor } from './InlineTermEditor';
import { useTargetPage } from '@/hooks/use-target-page';
import { useReviewMode } from '@/hooks/use-review-mode';
import { HhhQuestionnaire } from '@/components/review/HhhQuestionnaire';
import type { KeyTerm } from '@/types/domain';

export function KeyTermRow({
  term,
  tooltip,
  userId,
  contractId,
  pageCount,
  isRequired = false,
  stitched = false,
}: {
  term: KeyTerm;
  tooltip?: string;
  userId: string;
  contractId: string;
  /** Spec 07 v1.1 §D: the ceiling the page editor validates against. */
  pageCount: number;
  /** Spec 06 v1.1 §C: a required standard term (from the library). */
  isRequired?: boolean;
  /** Spec 22 §2: O8 is only asked of a stitched document. */
  stitched?: boolean;
}) {
  const { goToPage } = useTargetPage();
  const review = useReviewMode();
  const [value, setValue] = useState(term.value);
  const [isEdited, setIsEdited] = useState(term.is_edited);
  // Spec 07 v1.1 §D: the three fields save independently, so each keeps its
  // own optimistic state and its own edited flag.
  const [pageNumber, setPageNumber] = useState(term.page_number);
  const [pageEdited, setPageEdited] = useState(term.page_edited ?? false);
  const [reasoning, setReasoning] = useState(term.reasoning ?? null);
  const [reasoningEdited, setReasoningEdited] = useState(term.reasoning_edited ?? false);
  const [showWhy, setShowWhy] = useState(false);

  // Low-confidence auto-highlight (PRD §9 UI guardrails): expanding a term
  // under 50% navigates to its source sentence in one click.
  useEffect(() => {
    if (showWhy && term.confidence_score < 50 && pageNumber !== null) {
      goToPage(pageNumber, term.source_sentence);
    }
  }, [showWhy, term.confidence_score, pageNumber, term.source_sentence, goToPage]);

  return (
    <li className="flex flex-col gap-2 border-b border-grey-50 py-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <span className="flex items-center gap-2">
          <span className="text-body text-grey-900">{term.term_name}</span>
          {tooltip && (
            <InfoTooltip label={tooltip}>
              <Info aria-hidden="true" className="h-4 w-4" />
            </InfoTooltip>
          )}
          {term.is_custom && <Badge tone="brand">Custom</Badge>}
          {isRequired && value === null && (
            <InfoTooltip label="A required term we could not find — verify it in the document.">
              <Badge tone="warning">Required</Badge>
            </InfoTooltip>
          )}
          {isEdited && (
            <InfoTooltip label="You changed this. The original AI value is kept for accuracy tracking.">
              <Badge>Edited</Badge>
            </InfoTooltip>
          )}
        </span>

        <span className="flex items-center gap-2">
          <PageChip
            pageNumber={pageNumber}
            sourceSentence={term.source_sentence}
            edited={pageEdited}
            editor={
              <InlineTermEditor
                termId={term.id}
                userId={userId}
                contractId={contractId}
                field="page"
                value={pageNumber === null ? null : String(pageNumber)}
                pageCount={pageCount}
                onSaved={(next) => {
                  const page = Number(next);
                  if (!Number.isInteger(page)) return;
                  setPageNumber(page);
                  setPageEdited(true);
                  // §D: a saved page edit re-targets the viewer and re-scans
                  // the highlight, so the user lands on what they just claimed.
                  goToPage(page, term.source_sentence);
                }}
              />
            }
          />
          <ConfidenceBadge score={term.confidence_score} />
        </span>
      </div>

      <InlineTermEditor
        termId={term.id}
        userId={userId}
        contractId={contractId}
        field="value"
        value={value}
        onSaved={(next) => {
          setValue(next);
          setIsEdited(true);
        }}
      />

      {/*
        Spec 07 §C as amended by 5d-2a: the reasoning sits here, under the
        value and above the fold, so the answer, its page citation and the
        reason are read together (PRD R-16). Long reasoning (up to the 500-char
        server limit) wraps; it is never truncated.
      */}
      <span role="group" aria-label="Reasoning" className="flex flex-wrap items-baseline gap-2">
        {reasoning ? (
          <span className="text-caption text-grey-600">{reasoning}</span>
        ) : (
          <span className="text-caption text-grey-400">No reasoning was returned for this term.</span>
        )}
        {reasoningEdited && (
          <InfoTooltip label="You changed this. The original AI reasoning is kept for accuracy tracking.">
            <span className="rounded-badge bg-grey-50 px-1.5 py-0.5 text-caption text-grey-500">
              Reasoning edited
            </span>
          </InfoTooltip>
        )}
        <InlineTermEditor
          termId={term.id}
          userId={userId}
          contractId={contractId}
          field="reasoning"
          value={reasoning}
          onSaved={(next) => {
            setReasoning(next);
            setReasoningEdited(true);
          }}
        />
      </span>

      {pageNumber === null && term.confidence_score > 0 && (
        <p className="text-caption text-grey-400">No page reference — verify manually</p>
      )}

      <div>
        <button
          type="button"
          onClick={() => setShowWhy((v) => !v)}
          aria-expanded={showWhy}
          className="inline-flex items-center gap-1 text-caption text-grey-500 hover:text-grey-900"
        >
          <ChevronDown
            aria-hidden="true"
            className={`h-3.5 w-3.5 transition-transform ${showWhy ? 'rotate-180' : ''}`}
          />
          Why?
        </button>

        {showWhy && (
          <WhySection
            sourceSentence={term.source_sentence}
            // L11: where the MODEL found the sentence. A user who corrects the
            // page chip is saying where the term belongs, not rewriting where
            // this quote came from — "Found on page N" must keep pointing at
            // the text that was actually quoted.
            pageNumber={term.original_ai_page ?? pageNumber}
            isSourceVerified={term.is_source_verified}
          />
        )}

        {/* Spec 22 §4: the questionnaire sits below the Why section. */}
        {review?.reviewMode && (
          <HhhQuestionnaire
            contractId={contractId}
            subjectType="term"
            termId={term.id}
            stitched={stitched}
            label="Review this term"
          />
        )}
      </div>
    </li>
  );
}
