'use client';

import { useEffect, useState } from 'react';
import { ChevronDown, Info } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { InfoTooltip } from '@/components/ui/tooltip';
import { ConfidenceBadge } from './ConfidenceBadge';
import { PageChip } from './PageChip';
import { InlineTermEditor } from './InlineTermEditor';
import { useTargetPage } from '@/hooks/use-target-page';
import type { KeyTerm } from '@/types/domain';

export function KeyTermRow({
  term,
  tooltip,
  userId,
  contractId,
  isRequired = false,
}: {
  term: KeyTerm;
  tooltip?: string;
  userId: string;
  contractId: string;
  /** Spec 06 v1.1 §C: a required standard term (from the library). */
  isRequired?: boolean;
}) {
  const { goToPage } = useTargetPage();
  const [value, setValue] = useState(term.value);
  const [isEdited, setIsEdited] = useState(term.is_edited);
  const [showWhy, setShowWhy] = useState(false);

  // Low-confidence auto-highlight (PRD §9 UI guardrails): expanding a term
  // under 50% navigates to its source sentence in one click.
  useEffect(() => {
    if (showWhy && term.confidence_score < 50 && term.page_number !== null) {
      goToPage(term.page_number, term.source_sentence);
    }
  }, [showWhy, term.confidence_score, term.page_number, term.source_sentence, goToPage]);

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
            <InfoTooltip label="You edited this value. The original AI value is kept for accuracy tracking.">
              <Badge>Edited</Badge>
            </InfoTooltip>
          )}
        </span>

        <span className="flex items-center gap-2">
          <PageChip pageNumber={term.page_number} sourceSentence={term.source_sentence} />
          <ConfidenceBadge score={term.confidence_score} />
        </span>
      </div>

      <InlineTermEditor
        termId={term.id}
        userId={userId}
        contractId={contractId}
        value={value}
        onSaved={(next) => {
          setValue(next);
          setIsEdited(true);
        }}
      />

      {term.reasoning && (
        <p className="text-caption text-grey-600">
          <span className="font-medium text-grey-700">Why: </span>
          {term.reasoning}
        </p>
      )}

      {term.page_number === null && term.confidence_score > 0 && (
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
          <div className="mt-2 flex flex-col gap-1 border-l-2 border-grey-100 pl-3">
            {term.source_sentence ? (
              <>
                <blockquote className="text-body text-grey-600">
                  &ldquo;{term.source_sentence}&rdquo;
                </blockquote>
                {term.page_number !== null && (
                  <p className="text-caption text-grey-400">Found on page {term.page_number}</p>
                )}
                {!term.is_source_verified && (
                  <p className="text-caption text-danger-700">
                    We couldn&apos;t match this sentence to the document text — verify it directly.
                  </p>
                )}
              </>
            ) : (
              <p className="text-caption text-grey-400">
                No supporting sentence was found for this term.
              </p>
            )}
          </div>
        )}
      </div>
    </li>
  );
}
