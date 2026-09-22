'use client';

import { useRef, useState } from 'react';
import { UploadCloud } from 'lucide-react';
import { cn } from '@/lib/utils/cn';
import { publicConfig } from '@/lib/utils/config';

/**
 * Drag-and-drop plus file picker, both wired to one input so the whole control
 * is keyboard-operable (spec 04 §1).
 */
export function PdfDropzone({
  locked,
  onFile,
}: {
  locked: boolean;
  onFile: (file: File) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  function openPicker() {
    if (locked) return;
    inputRef.current?.click();
  }

  return (
    <div className="flex flex-col gap-2">
      <div
        role="button"
        tabIndex={locked ? -1 : 0}
        aria-disabled={locked}
        aria-label="Upload a PDF contract"
        onClick={openPicker}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            openPicker();
          }
        }}
        onDragOver={(event) => {
          if (locked) return;
          event.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setIsDragging(false);
          if (locked) return;
          const file = event.dataTransfer.files[0];
          if (file) onFile(file);
        }}
        className={cn(
          'flex flex-col items-center gap-3 rounded-card border border-dashed px-6 py-16 text-center transition-colors',
          locked
            ? 'cursor-not-allowed border-grey-100 bg-grey-25 text-grey-300'
            : 'cursor-pointer border-grey-200 text-grey-500 hover:border-brand-500',
          isDragging && !locked && 'border-brand-500 bg-brand-50',
        )}
      >
        <UploadCloud aria-hidden="true" className="h-8 w-8" />
        {locked ? (
          <p className="text-body">Choose a contract type first.</p>
        ) : (
          <>
            <p className="text-body text-grey-900">Drag a PDF here, or browse</p>
            <p className="text-caption text-grey-400">
              PDF · up to {publicConfig.maxUploadMb} MB · up to {publicConfig.maxPages} pages
            </p>
            <p className="text-caption text-grey-400">Text-layer PDF only for now.</p>
          </>
        )}
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="application/pdf"
        aria-label="Choose a PDF contract"
        className="sr-only-live"
        tabIndex={-1}
        disabled={locked}
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) onFile(file);
          // Allow re-selecting the same file after an error.
          event.target.value = '';
        }}
      />
    </div>
  );
}
