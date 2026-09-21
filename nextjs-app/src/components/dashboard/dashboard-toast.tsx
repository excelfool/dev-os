'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

/**
 * A confirmation that must outlive the component that triggered it.
 *
 * Deleting the user's LAST contract flips the dashboard from the table branch
 * to <EmptyState /> on the next router.refresh(). The toast used to be local
 * state inside ContractsTable, which that switch unmounts — so "Contract and
 * all associated data deleted." lived only until the RSC response landed, a
 * few hundred milliseconds, and was gone before most people would read it.
 * Spec 11 §5 requires the confirmation. State now lives here, provided from
 * the root layout, which survives the refresh at the same tree position.
 */

const TOAST_LIFETIME_MS = 5_000;

interface DashboardToastValue {
  message: string | null;
  show: (message: string) => void;
}

const DashboardToastContext = createContext<DashboardToastValue | null>(null);

export function DashboardToastProvider({ children }: { children: React.ReactNode }) {
  const [message, setMessage] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const show = useCallback((next: string) => {
    if (timer.current) clearTimeout(timer.current);
    setMessage(next);
    timer.current = setTimeout(() => setMessage(null), TOAST_LIFETIME_MS);
  }, []);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const value = useMemo(() => ({ message, show }), [message, show]);
  return <DashboardToastContext.Provider value={value}>{children}</DashboardToastContext.Provider>;
}

export function useDashboardToast(): DashboardToastValue {
  const ctx = useContext(DashboardToastContext);
  if (!ctx) throw new Error('useDashboardToast must be used inside DashboardToastProvider');
  return ctx;
}

/** Rendered by the dashboard page ABOVE the empty-state/table branch. */
export function DashboardToast() {
  const { message } = useDashboardToast();
  if (!message) return null;
  return (
    <p role="status" className="rounded-card bg-success-50 px-4 py-2 text-caption text-success-700">
      {message}
    </p>
  );
}
