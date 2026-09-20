'use client';

import { useState } from 'react';
import { CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { formatDate } from '@/lib/utils/format';

/**
 * Closes the North Star timer (spec 10 §1). Marking complete does NOT lock the
 * contract — editing, chatting and export all remain available.
 */
export function CompleteReviewButton({
  contractId,
  initialCompletedAt,
}: {
  contractId: string;
  initialCompletedAt: string | null;
}) {
  const [completedAt, setCompletedAt] = useState(initialCompletedAt);
  const [isSaving, setIsSaving] = useState(false);
  const [toast, setToast] = useState(false);

  async function markComplete() {
    setIsSaving(true);
    try {
      const res = await fetch(`/api/contracts/${contractId}/complete`, { method: 'POST' });
      if (!res.ok) return;
      const body = await res.json();
      setCompletedAt(body.review_completed_at);
      setToast(true);
      setTimeout(() => setToast(false), 3000);
    } finally {
      setIsSaving(false);
    }
  }

  if (completedAt) {
    /**
     * Spec 10 §1 requires BOTH the confirmation toast and the "Review complete"
     * state. Returning early here made the toast unreachable: marking complete
     * sets `completedAt`, which lands on this branch before the toast could
     * ever render. Same shape as the signup error state (deviation 8) — a
     * state written but never reachable. Found by driving this in a browser.
     */
    return (
      <div className="flex items-center gap-3">
        <p className="inline-flex items-center gap-2 text-body text-success-700">
          <CheckCircle2 aria-hidden="true" className="h-4 w-4" />
          Review complete · {formatDate(completedAt)}
        </p>
        {toast && (
          <span role="status" className="text-caption text-success-700">
            Review marked complete
          </span>
        )}
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3">
      <Button onClick={() => void markComplete()} disabled={isSaving}>
        Mark review complete
      </Button>
      {toast && (
        <span role="status" className="text-caption text-success-700">
          Review marked complete
        </span>
      )}
    </div>
  );
}
