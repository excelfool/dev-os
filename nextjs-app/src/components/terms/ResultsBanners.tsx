'use client';

import { useState } from 'react';
import { AlertTriangle, ChevronDown, X } from 'lucide-react';
import type { ContractType } from '@/types/domain';

/** Non-dismissible, on every results page (spec 16 §6). */
export function DisclaimerBanner() {
  return (
    <p role="note" className="rounded-card bg-grey-50 px-4 py-3 text-caption text-grey-600">
      This is an AI-assisted review tool, not legal advice. Always verify critical terms with a
      qualified lawyer.
    </p>
  );
}

export function TypeMismatchNotice({ contractType }: { contractType: ContractType }) {
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) return null;

  return (
    <div role="status" className="flex items-start gap-2 rounded-card bg-warning-50 px-4 py-3">
      <AlertTriangle aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-warning-900" />
      <p className="flex-1 text-caption text-warning-900">
        This doesn&apos;t look like the {contractType} you selected — we still extracted everything
        we could, but some type-specific terms may be missing.
      </p>
      <button type="button" onClick={() => setDismissed(true)} aria-label="Dismiss">
        <X aria-hidden="true" className="h-4 w-4 text-warning-900" />
      </button>
    </div>
  );
}

export function CalibrationNotice() {
  return (
    <p role="status" className="rounded-card bg-warning-50 px-4 py-3 text-caption text-warning-900">
      Our confidence scores are currently being recalibrated — treat them as approximate.
    </p>
  );
}

/** Model limitations, stated verbatim per spec 16 §6. */
export function AboutTheseResults() {
  const [open, setOpen] = useState(false);

  return (
    <div className="rounded-card border border-grey-100">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left"
      >
        <span className="text-body text-grey-900">About these results</span>
        <ChevronDown
          aria-hidden="true"
          className={`h-4 w-4 text-grey-400 transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open && (
        <div className="flex flex-col gap-2 px-4 pb-4 text-caption text-grey-500">
          <p>
            ContractIQ accurately extracts standard NDA and MSA terms from English-language,
            text-layer PDFs at 88% F1 or better for NDAs and 85% or better for MSAs.
          </p>
          <p>
            It does not provide legal advice, does not handle scanned PDFs, does not support
            non-English contracts, and may miss highly unusual or bespoke clauses outside standard
            NDA and MSA structures.
          </p>
          <p>
            Known gaps: accuracy is lower for contracts drafted under non-US and non-UK conventions,
            including South Asian, African and Latin American jurisdictions, and for specialised
            industries such as healthcare and defence. We are addressing this by collecting opt-in
            anonymised non-US contracts to build jurisdiction-specific examples in a future release.
          </p>
        </div>
      )}
    </div>
  );
}
