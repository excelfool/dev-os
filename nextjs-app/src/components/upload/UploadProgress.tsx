'use client';

import { Button } from '@/components/ui/button';

export function UploadProgress({
  fileName,
  progress,
  onCancel,
}: {
  fileName: string;
  progress: number;
  onCancel: () => void;
}) {
  return (
    <div className="flex flex-col gap-3 rounded-card border border-grey-100 p-6">
      <div className="flex items-center justify-between gap-4">
        <span className="min-w-0 truncate text-body text-grey-900">{fileName}</span>
        <Button variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
      </div>

      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={progress}
        aria-label="Upload progress"
        className="h-2 w-full overflow-hidden rounded-full bg-grey-50"
      >
        <div
          className="h-full bg-brand-500 transition-[width]"
          style={{ width: `${progress}%` }}
        />
      </div>

      <p aria-live="polite" className="text-caption text-grey-400">
        Uploading, {progress} percent
      </p>
    </div>
  );
}
