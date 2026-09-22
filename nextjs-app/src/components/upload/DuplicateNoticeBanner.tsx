'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { formatDate } from '@/lib/utils/format';
import { readDuplicateNotice, type DuplicateNotice } from './duplicate-notice';

/**
 * D46: shown at the top of /contracts/[id]/prepare when this upload matched an
 * earlier one byte-for-byte. Non-blocking — the new upload proceeds.
 */
export function DuplicateNoticeBanner({ contractId }: { contractId: string }) {
  const [notice, setNotice] = useState<DuplicateNotice | null>(null);

  // Read after mount: sessionStorage does not exist during server render.
  useEffect(() => {
    setNotice(readDuplicateNotice(contractId));
  }, [contractId]);

  if (!notice) return null;

  return (
    <p role="status" aria-label="Duplicate upload" className="rounded-card bg-brand-50 p-4 text-caption text-brand-700">
      You already uploaded this file on {formatDate(notice.createdAt)} — opening the{' '}
      <Link href={`/contracts/${notice.duplicateOf}`} className="underline">
        existing analysis
      </Link>{' '}
      is faster.
    </p>
  );
}
