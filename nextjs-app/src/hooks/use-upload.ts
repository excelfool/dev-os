'use client';

import { useMutation } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import type { ContractType } from '@/types/domain';

export interface UploadResponse {
  contract_id: string;
  page_count: number;
  token_estimate: number;
  storage_available: boolean;
  status: 'uploaded';
  /** Present when OCR produced the text (spec 04 v1.1 §B). */
  ocr_confidence?: number;
  /** D46: an earlier upload of the same bytes by this user. */
  duplicate_of?: string;
  duplicate_created_at?: string;
}

export interface UploadError {
  code: string;
  message: string;
  retryable: boolean;
}

/**
 * Multipart upload with determinate progress and cancellation (spec 04 §5).
 * XMLHttpRequest is used because fetch exposes no upload-progress event.
 */
export function useUpload() {
  const [progress, setProgress] = useState(0);
  const xhrRef = useRef<XMLHttpRequest | null>(null);

  const mutation = useMutation<UploadResponse, UploadError, { file: File; contractType: ContractType }>({
    mutationFn: ({ file, contractType }) =>
      new Promise<UploadResponse>((resolve, reject) => {
        const form = new FormData();
        form.append('file', file);
        form.append('contract_type', contractType);

        const xhr = new XMLHttpRequest();
        xhrRef.current = xhr;
        setProgress(0);

        xhr.upload.addEventListener('progress', (event) => {
          if (event.lengthComputable) {
            setProgress(Math.round((event.loaded / event.total) * 100));
          }
        });

        xhr.addEventListener('load', () => {
          try {
            const body = JSON.parse(xhr.responseText);
            if (xhr.status >= 200 && xhr.status < 300) resolve(body as UploadResponse);
            else reject(body.error as UploadError);
          } catch {
            reject({
              code: 'INTERNAL',
              message: 'Something went wrong on our side. Please try again.',
              retryable: true,
            });
          }
        });

        xhr.addEventListener('error', () =>
          reject({
            code: 'INTERNAL',
            message: "We couldn't reach the server. Please try again.",
            retryable: true,
          }),
        );

        // A cancelled upload writes nothing — the request never completes.
        xhr.addEventListener('abort', () =>
          reject({ code: 'ABORTED', message: 'Upload cancelled.', retryable: false }),
        );

        xhr.open('POST', '/api/contracts/upload');
        xhr.send(form);
      }),
  });

  function cancel() {
    xhrRef.current?.abort();
  }

  return {
    upload: mutation.mutateAsync,
    reset: () => {
      mutation.reset();
      setProgress(0);
    },
    cancel,
    progress,
    isPending: mutation.isPending,
    error: mutation.error,
  };
}
