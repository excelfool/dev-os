'use client';

import { useCallback, useMemo, useState } from 'react';
import { Download } from 'lucide-react';
import { PdfViewer } from './PdfViewer';
import { TextViewer } from './TextViewer';
import { useTargetPage } from '@/hooks/use-target-page';
import { createBrowserSupabaseClient } from '@/lib/supabase/client';
import { recordEvent } from '@/lib/metrics/events';

/**
 * Viewer selection (spec 07 §2):
 *   file_path != null AND PDF.js renders -> PdfViewer
 *   file_path != null AND PDF.js throws  -> TextViewer + DownloadPdfLink
 *   file_path == null                    -> TextViewer (+ purge note)
 */
export function DocumentPanel({
  contractId,
  userId,
  contractText,
  pageCount,
  hasFile,
  pdfPurgedAt,
}: {
  contractId: string;
  userId: string;
  contractText: string;
  pageCount: number;
  hasFile: boolean;
  pdfPurgedAt: string | null;
}) {
  const { targetPage, highlight, nonce } = useTargetPage();
  const supabase = useMemo(() => createBrowserSupabaseClient(), []);
  const [pdfFailed, setPdfFailed] = useState(false);
  const [fileMissing, setFileMissing] = useState(false);

  const handleRenderFailure = useCallback(
    (reason: string) => {
      // NO_FILE is the expected state after a purge or Storage failure — it is
      // not an error to the user, so nothing is recorded for it.
      if (reason === 'NO_FILE') {
        setFileMissing(true);
        return;
      }
      setPdfFailed(true);
      void recordEvent(supabase, {
        userId,
        contractId,
        eventType: 'pdf_render_failed',
        metadata: { reason: reason.slice(0, 120) },
      });
    },
    [supabase, userId, contractId],
  );

  const useTextViewer = !hasFile || pdfFailed || fileMissing;

  if (useTextViewer) {
    return (
      <div className="flex h-full flex-col">
        {pdfFailed && hasFile && !fileMissing && <DownloadPdfLink contractId={contractId} />}
        <TextViewer
          contractText={contractText}
          pdfPurgedAt={pdfPurgedAt}
          pageCount={pageCount}
          targetPage={targetPage}
          highlight={highlight}
          nonce={nonce}
        />
      </div>
    );
  }

  return (
    <PdfViewer
      contractId={contractId}
      pageCount={pageCount}
      targetPage={targetPage}
      highlight={highlight}
      nonce={nonce}
      onRenderFailure={handleRenderFailure}
    />
  );
}

function DownloadPdfLink({ contractId }: { contractId: string }) {
  const [isFetching, setIsFetching] = useState(false);

  async function download() {
    setIsFetching(true);
    try {
      const res = await fetch(`/api/contracts/${contractId}/signed-url`, { method: 'POST' });
      if (!res.ok) return;
      const { url } = await res.json();
      window.open(url, '_blank', 'noopener,noreferrer');
    } finally {
      setIsFetching(false);
    }
  }

  return (
    <div className="flex items-center justify-between gap-2 bg-warning-50 px-4 py-2">
      <p className="text-caption text-warning-900">
        We couldn&apos;t display the PDF — showing the contract text instead.
      </p>
      <button
        type="button"
        onClick={() => void download()}
        disabled={isFetching}
        className="inline-flex items-center gap-1 text-caption text-warning-900 underline"
      >
        <Download aria-hidden="true" className="h-3.5 w-3.5" />
        Download PDF
      </button>
    </div>
  );
}
