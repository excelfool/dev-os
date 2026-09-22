'use client';

import { publicConfig } from '@/lib/utils/config';

/**
 * Client pre-checks, run before a single byte leaves the browser (spec 04 §1).
 * These are advisory only — the server re-validates everything.
 */
export const DOCX_MESSAGE =
  "Word documents aren't supported yet — export the contract as a PDF and upload that. DOCX support arrives in v1.1.";
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

export interface PrecheckFailure {
  message: string;
}

export async function precheckFile(file: File): Promise<PrecheckFailure | null> {
  // v1.1 (spec 04 §A): a Word document gets its own message, verbatim.
  if (/\.docx$/i.test(file.name) || file.type === DOCX_MIME) {
    return { message: DOCX_MESSAGE };
  }
  if (file.type !== 'application/pdf') {
    return { message: "That file isn't a PDF. Please upload a PDF contract." };
  }

  const limitBytes = publicConfig.maxUploadMb * 1024 * 1024;
  if (file.size > limitBytes) {
    return {
      message: `This file is ${(file.size / (1024 * 1024)).toFixed(1)} MB — the limit is ${publicConfig.maxUploadMb} MB.`,
    };
  }

  const pageCount = await countPages(file);
  if (pageCount !== null && pageCount > publicConfig.maxPages) {
    return {
      message: `This contract is ${pageCount} pages — the limit is ${publicConfig.maxPages} pages for now.`,
    };
  }

  return null;
}

async function countPages(file: File): Promise<number | null> {
  try {
    const pdfjs = await import('pdfjs-dist');
    pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';
    const data = new Uint8Array(await file.arrayBuffer());
    const loadingTask = pdfjs.getDocument({ data });
    const doc = await loadingTask.promise;
    const pages = doc.numPages;
    // destroy() lives on the loading task, not the document proxy.
    await loadingTask.destroy();
    return pages;
  } catch {
    // An unreadable file is the server's call to reject with CORRUPT_PDF —
    // the pre-check stays advisory and never blocks on its own failure.
    return null;
  }
}

/**
 * Non-blocking device advisory (spec 04 §1): browser file-API limits are a
 * stated external dependency.
 */
export function shouldShowDeviceAdvisory(file: File): boolean {
  const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  const constrained = (memory !== undefined && memory < 4) || window.innerWidth < 768;
  return constrained && file.size > 7 * 1024 * 1024;
}
