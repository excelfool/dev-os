'use client';

import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { AlertCircle } from 'lucide-react';
import { ContractTypeSelect } from './ContractTypeSelect';
import { PdfDropzone } from './PdfDropzone';
import { ImportSourceOptions } from './ImportSourceOptions';
import { formatDate } from '@/lib/utils/format';
import { useState } from 'react';
import { UploadProgress } from './UploadProgress';
import { precheckFile, shouldShowDeviceAdvisory } from './pdf-precheck';
import { UploadWizardProvider, useUploadWizard } from './UploadWizardContext';
import { useUpload } from '@/hooks/use-upload';

export function UploadWizard() {
  return (
    <UploadWizardProvider>
      <UploadWizardInner />
    </UploadWizardProvider>
  );
}

function UploadWizardInner() {
  const router = useRouter();
  const { state, dispatch } = useUploadWizard();
  const { upload, cancel, progress, isPending } = useUpload();
  const [duplicate, setDuplicate] = useState<{ id: string; createdAt: string } | null>(null);

  async function handleFile(file: File) {
    if (!state.contractType) return;

    const failure = await precheckFile(file);
    if (failure) {
      dispatch({ type: 'client_error', message: failure.message });
      return;
    }

    dispatch({ type: 'set_file', file, deviceAdvisory: shouldShowDeviceAdvisory(file) });

    try {
      const result = await upload({ file, contractType: state.contractType });
      // D46: non-blocking — the notice is shown and the new upload proceeds.
      if (result.duplicate_of && result.duplicate_created_at) {
        setDuplicate({ id: result.duplicate_of, createdAt: result.duplicate_created_at });
      }
      // Straight to /prepare — no intermediate screen.
      router.push(`/contracts/${result.contract_id}/prepare`);
    } catch (err) {
      const error = err as { code?: string; message?: string };
      if (error.code === 'ABORTED') {
        dispatch({ type: 'clear_file' });
        return;
      }
      dispatch({
        type: 'server_error',
        message: error.message ?? 'Something went wrong on our side. Please try again.',
      });
    }
  }

  const error = state.clientError ?? state.serverError;
  const isQuotaError = state.serverError !== null && /analyses|free trial has ended/i.test(state.serverError);

  return (
    <div className="flex flex-col gap-component">
      <ContractTypeSelect
        value={state.contractType}
        onChange={(contractType) => dispatch({ type: 'set_contract_type', contractType })}
        disabled={isPending}
      />

      {error && (
        <div role="alert" className="flex items-start gap-2 rounded-card bg-danger-50 p-4">
          <AlertCircle aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-danger-700" />
          <div className="flex flex-col gap-1">
            <p className="text-body text-danger-700">{error}</p>
            {isQuotaError && (
              <Link href="/settings" className="text-caption text-danger-700 underline">
                See your plan and when it resets
              </Link>
            )}
          </div>
        </div>
      )}

      {duplicate && (
        <p role="status" className="rounded-card bg-brand-50 p-4 text-caption text-brand-700">
          You already uploaded this file on {formatDate(duplicate.createdAt)} — opening the{' '}
          <Link href={`/contracts/${duplicate.id}`} className="underline">
            existing analysis
          </Link>{' '}
          is faster.
        </p>
      )}

      {state.deviceAdvisory && !error && (
        <p role="status" className="rounded-card bg-warning-50 p-4 text-caption text-warning-900">
          For files near 10 MB we recommend desktop Chrome or Firefox.
        </p>
      )}

      {isPending && state.file ? (
        <UploadProgress fileName={state.file.name} progress={progress} onCancel={cancel} />
      ) : (
        <>
          <ImportSourceOptions />
          <PdfDropzone locked={!state.contractType} onFile={handleFile} />
        </>
      )}
    </div>
  );
}
