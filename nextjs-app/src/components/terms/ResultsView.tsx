'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { DocumentPanel } from '@/components/viewer/DocumentPanel';
import { ChatPanel } from '@/components/chat/ChatPanel';
import { FeedbackWidget } from '@/components/feedback/FeedbackWidget';
import { CompleteReviewButton } from '@/components/feedback/CompleteReviewButton';
import { NpsSurvey } from '@/components/feedback/NpsSurvey';
import { KeyTermsPanel } from './KeyTermsPanel';
import { SummaryCard } from './SummaryCard';
import { KeyDatesCard } from './KeyDatesCard';
import { ProcessingSteps } from './ProcessingSteps';
import {
  AboutTheseResults,
  CalibrationNotice,
  DisclaimerBanner,
  ReviewNeededNotice,
  TypeMismatchNotice,
} from './ResultsBanners';
import { requiredMissingNames } from '@/lib/ai/term-library';
import { TargetPageProvider } from '@/hooks/use-target-page';
import { ReviewModeProvider } from '@/hooks/use-review-mode';
import { ReviewModeToggle } from '@/components/review/ReviewModeToggle';
import { ReviewFooter } from '@/components/review/ReviewFooter';
import { createBrowserSupabaseClient } from '@/lib/supabase/client';
import { recordEvent } from '@/lib/metrics/events';
import { Button } from '@/components/ui/button';
import type { Contract, ContractType, KeyDate, KeyTerm, Rating, SurveyAccuracy } from '@/types/domain';

export function ResultsView({
  contract,
  keyTerms,
  userId,
  calibrationWarningActive,
  initialFeedback,
  initialKeyDates,
  reviewModeRequested = false,
}: {
  contract: Contract;
  keyTerms: KeyTerm[];
  userId: string;
  calibrationWarningActive: boolean;
  initialFeedback: { rating: Rating | null; survey_accuracy: SurveyAccuracy | null } | null;
  initialKeyDates?: KeyDate[];
  /** Spec 22 §4: `?mode=review` opens the page with Review mode already on. */
  reviewModeRequested?: boolean;
}) {
  const [reviewCompleted, setReviewCompleted] = useState(
    Boolean(contract.review_completed_at),
  );
  const router = useRouter();
  const supabase = useMemo(() => createBrowserSupabaseClient(), []);

  // While processing, poll every 2s until the contract settles.
  const { data: polled } = useQuery({
    queryKey: ['contract', contract.id],
    queryFn: async () => {
      const res = await fetch(`/api/contracts/${contract.id}`);
      if (!res.ok) throw new Error('poll failed');
      return (await res.json()) as { contract: Contract; key_terms: KeyTerm[] };
    },
    enabled: contract.status === 'processing',
    refetchInterval: 2_000,
  });

  const current = polled?.contract ?? contract;
  const terms = polled?.key_terms ?? keyTerms;
  // Spec 06 v1.1 §C — computed from the library so it works before the
  // is_required column exists on the row.
  const requiredMissing = requiredMissingNames(current.contract_type as ContractType, terms);
  const ocrConfidence =
    typeof current.ocr_confidence === 'number' ? Math.round(current.ocr_confidence) : null;

  useEffect(() => {
    if (current.status === 'completed') {
      void recordEvent(supabase, {
        userId,
        contractId: current.id,
        eventType: 'results_viewed',
      });
    }
  }, [current.status, current.id, supabase, userId]);

  useEffect(() => {
    // A contract that finishes while polling needs a server re-render so the
    // page picks up the completed shell.
    if (contract.status === 'processing' && current.status === 'completed') router.refresh();
  }, [contract.status, current.status, router]);

  async function retry() {
    await fetch(`/api/contracts/${current.id}/process`, { method: 'POST' });
    router.refresh();
  }

  if (current.status === 'processing') {
    return <ProcessingSteps stage="analysing" />;
  }

  if (current.status === 'error') {
    return (
      <div className="flex flex-col gap-subsection rounded-card border border-danger-100 bg-danger-50 p-6">
        <p role="alert" className="text-body text-danger-700">
          {current.error_message ?? 'Something went wrong on our side. Please try again.'}
        </p>
        <Button onClick={() => void retry()} className="self-start">
          Try again in a few minutes
        </Button>
      </div>
    );
  }

  return (
    <TargetPageProvider>
      <ReviewModeProvider initialOn={reviewModeRequested}>
      <div className="flex flex-col gap-subsection">
        <div className="flex items-center justify-end gap-2">
          <ReviewModeToggle />
        </div>
        <DisclaimerBanner />
        {current.type_mismatch_warning && (
          <TypeMismatchNotice contractType={current.contract_type as ContractType} />
        )}
        {calibrationWarningActive && <CalibrationNotice />}
        <AboutTheseResults />

        <div className="grid gap-subsection lg:grid-cols-[58fr_42fr]">
          <div className="flex flex-col gap-2">
            <div className="h-[70vh] overflow-hidden rounded-card border border-grey-100">
              <DocumentPanel
                contractId={current.id}
                userId={userId}
                contractText={current.contract_text}
                pageCount={current.page_count}
                hasFile={current.file_path !== null}
                pdfPurgedAt={current.pdf_purged_at}
              />
            </div>
            {ocrConfidence !== null && (
              <p className="text-caption text-grey-500">
                Scanned document — OCR confidence {ocrConfidence}%
              </p>
            )}
          </div>

          <div className="h-[70vh] overflow-y-auto rounded-card border border-grey-100 p-4">
            <ReviewNeededNotice names={requiredMissing} />
            {/* Spec 07 v1.1 §A order: Summary → (Risk, not built) → Key terms → Key dates */}
            <SummaryCard key={`${current.id}-${current.summary_status ?? 'none'}`} contract={current} />
            <KeyTermsPanel
              terms={terms}
              contractType={current.contract_type as ContractType}
              userId={userId}
              contractId={current.id}
              pageCount={current.page_count}
            />
            <KeyDatesCard contractId={current.id} initialKeyDates={initialKeyDates} terms={terms} />

            <div className="mt-component flex flex-col gap-subsection">
              <div onClick={() => setReviewCompleted(true)}>
                <CompleteReviewButton
                  contractId={current.id}
                  initialCompletedAt={current.review_completed_at}
                />
              </div>
              <FeedbackWidget
                contractId={current.id}
                initialRating={initialFeedback?.rating ?? null}
                initialSurvey={initialFeedback?.survey_accuracy ?? null}
              />
            </div>
          </div>
        </div>

        <ChatPanel contractId={current.id} contractType={current.contract_type as ContractType} />
        {/* Session end: the user marked a review complete (spec 10 §3). */}
        <NpsSurvey trigger={reviewCompleted} />
      </div>
        <ReviewFooter termCount={terms.length} />
      </ReviewModeProvider>
    </TargetPageProvider>
  );
}
