'use client';

import Link from 'next/link';
import { useEffect } from 'react';

/**
 * Uncaught-error boundary (spec 16 §3). Logs the digest but never shows the
 * raw error message, and never renders contract data.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(JSON.stringify({ boundary: 'app/error', digest: error.digest ?? null }));
  }, [error]);

  return (
    <main className="mx-auto flex min-h-[60vh] max-w-xl flex-col items-center justify-center gap-subsection px-4 text-center">
      <h1 className="text-h3 text-grey-900">Something went wrong on our side.</h1>
      <p className="text-body text-grey-500">
        Please try again. If it keeps happening, head back to your dashboard.
      </p>
      <div className="flex items-center gap-4">
        <button
          type="button"
          onClick={reset}
          className="rounded-btn bg-brand-500 px-6 py-3 text-body text-white hover:bg-brand-600"
        >
          Try again
        </button>
        <Link href="/dashboard" className="text-body text-brand-500 underline">
          Go to dashboard
        </Link>
      </div>
    </main>
  );
}
