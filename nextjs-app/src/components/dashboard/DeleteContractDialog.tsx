'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';

/**
 * Names exactly what is removed, so consent is informed (spec 11 §1).
 * Cancel is focused by default; Delete carries destructive styling.
 */
export function DeleteContractDialog({
  fileName,
  onConfirm,
  trigger,
}: {
  fileName: string;
  onConfirm: () => Promise<void>;
  trigger: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogTitle className="text-h5 text-grey-900">Delete &ldquo;{fileName}&rdquo;?</DialogTitle>
        <DialogDescription className="mt-2 text-body text-grey-500">
          This permanently removes the PDF, the extracted text, all key terms, your chat history and
          any feedback for this contract. This cannot be undone.
        </DialogDescription>

        <div className="mt-subsection flex justify-end gap-2">
          <DialogClose asChild>
            <Button variant="secondary" autoFocus>
              Cancel
            </Button>
          </DialogClose>
          <Button
            variant="destructive"
            disabled={isDeleting}
            onClick={async () => {
              setIsDeleting(true);
              try {
                await onConfirm();
                setOpen(false);
              } finally {
                setIsDeleting(false);
              }
            }}
          >
            {isDeleting ? 'Deleting…' : 'Delete'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
