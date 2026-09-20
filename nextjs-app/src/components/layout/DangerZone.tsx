'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { createBrowserSupabaseClient } from '@/lib/supabase/client';

/** Account deletion (spec 11 §3). Requires typing DELETE to enable. */
export function DangerZone() {
  const router = useRouter();
  const supabase = useMemo(() => createBrowserSupabaseClient(), []);
  const [confirmation, setConfirmation] = useState('');
  const [isDeleting, setIsDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function deleteAccount() {
    setIsDeleting(true);
    setError(null);
    try {
      const res = await fetch('/api/account', { method: 'DELETE' });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setError(body?.error?.message ?? 'We could not delete your account. Please try again.');
        return;
      }
      await supabase.auth.signOut();
      router.replace('/?deleted=1');
      router.refresh();
    } finally {
      setIsDeleting(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-body text-grey-500">
        Deleting your account removes every contract, PDF, extracted text, key term, chat message
        and feedback entry, along with the account itself. This cannot be undone.
      </p>

      <Dialog>
        <DialogTrigger asChild>
          <Button variant="destructive" className="self-start">
            Delete my account and all data
          </Button>
        </DialogTrigger>

        <DialogContent>
          <DialogTitle className="text-h5 text-grey-900">Delete your account?</DialogTitle>
          <DialogDescription className="mt-2 text-body text-grey-500">
            This permanently removes every contract, PDF, extracted text, key term, chat message and
            feedback entry, and the account itself. This cannot be undone.
          </DialogDescription>

          <label htmlFor="confirm-delete" className="mt-subsection block text-caption text-grey-500">
            Type DELETE to confirm
          </label>
          <Input
            id="confirm-delete"
            value={confirmation}
            onChange={(e) => setConfirmation(e.target.value)}
            className="mt-1"
          />

          {error && (
            <p role="alert" className="mt-2 text-caption text-danger-700">
              {error}
            </p>
          )}

          <div className="mt-subsection flex justify-end gap-2">
            <DialogClose asChild>
              <Button variant="secondary" autoFocus>
                Cancel
              </Button>
            </DialogClose>
            <Button
              variant="destructive"
              disabled={confirmation !== 'DELETE' || isDeleting}
              onClick={() => void deleteAccount()}
            >
              {isDeleting ? 'Deleting…' : 'Delete everything'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
