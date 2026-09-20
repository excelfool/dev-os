'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { createBrowserSupabaseClient } from '@/lib/supabase/client';
import type { Plan } from '@/types/domain';

const PLAN_LABELS: Record<Plan, string> = {
  free_trial: 'Free trial',
  starter: 'Starter',
  growth: 'Growth',
  pro: 'Pro',
};

export function Navbar({ email, plan }: { email: string; plan: Plan }) {
  const router = useRouter();
  const supabase = useMemo(() => createBrowserSupabaseClient(), []);
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  async function handleSignOut() {
    await supabase.auth.signOut();
    // refresh() clears the server cookie so no Server Component cache retains
    // user data (spec 03 §9).
    router.replace('/');
    router.refresh();
  }

  return (
    <header className="border-b border-grey-100 px-4 py-3">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4">
        <Link href="/dashboard" className="text-h5 text-grey-900">
          ContractIQ
        </Link>

        <div className="flex items-center gap-4">
          <Link
            href="/contracts/new"
            className="rounded-btn bg-brand-500 px-4 py-2 text-body text-white hover:bg-brand-600"
          >
            Review a Contract
          </Link>

          <div className="relative" ref={menuRef}>
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              aria-expanded={open}
              aria-haspopup="menu"
              className="flex items-center gap-2 rounded-btn px-2 py-2 text-body text-grey-600 hover:bg-grey-50"
            >
              <span className="max-w-[16ch] truncate">{email}</span>
              <ChevronDown aria-hidden="true" className="h-4 w-4" />
            </button>

            {open && (
              <div
                role="menu"
                className="absolute right-0 z-20 mt-1 w-56 rounded-card border border-grey-100 bg-white p-2 shadow-lg"
              >
                <div className="flex items-center justify-between px-2 py-2">
                  <span className="text-caption text-grey-400">Plan</span>
                  <Badge tone="brand">{PLAN_LABELS[plan]}</Badge>
                </div>
                <Link
                  href="/settings"
                  role="menuitem"
                  onClick={() => setOpen(false)}
                  className="block rounded-btn px-2 py-2 text-body text-grey-900 hover:bg-grey-50"
                >
                  Settings
                </Link>
                <button
                  type="button"
                  role="menuitem"
                  onClick={handleSignOut}
                  className="block w-full rounded-btn px-2 py-2 text-left text-body text-grey-900 hover:bg-grey-50"
                >
                  Sign out
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}
