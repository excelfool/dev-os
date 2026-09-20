'use client';

import { useQuery } from '@tanstack/react-query';
import { AlertTriangle } from 'lucide-react';
import { publicConfig } from '@/lib/utils/config';
import type { IncidentLevel } from '@/types/domain';

interface SystemStatus {
  level: IncidentLevel;
  message: string;
}

/**
 * Incident banner (spec 14 §2). Polls every 60s; the row is written with the
 * service role, so an operator raises a banner without a deploy.
 */
export function SystemStatusBanner() {
  const { data } = useQuery<SystemStatus>({
    queryKey: ['system-status'],
    queryFn: async () => {
      const res = await fetch('/api/system-status');
      if (!res.ok) throw new Error('status unavailable');
      return res.json();
    },
    refetchInterval: 60_000,
    // A failed poll must never take the app down or spam the user.
    retry: false,
  });

  if (!data || data.level === 'none') return null;

  const isP0 = data.level === 'p0';

  return (
    <div
      role="status"
      aria-live="polite"
      className={
        isP0
          ? 'flex items-center justify-center gap-2 bg-danger-600 px-4 py-2 text-white'
          : 'flex items-center justify-center gap-2 bg-warning-100 px-4 py-2 text-warning-900'
      }
    >
      <AlertTriangle aria-hidden="true" className="h-4 w-4 shrink-0" />
      <p className="text-caption">{data.message}</p>
      {publicConfig.statusPageUrl && (
        <a
          href={publicConfig.statusPageUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-caption underline"
        >
          Service status
        </a>
      )}
    </div>
  );
}
