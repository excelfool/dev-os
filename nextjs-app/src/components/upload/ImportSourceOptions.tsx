'use client';

import Link from 'next/link';
import { Cloud, FileText, FolderOpen, HardDrive, ScanLine } from 'lucide-react';
import { getCapability, type CapabilityKey } from '@/lib/capabilities';

/**
 * Disabled import options naming their phase (spec 21 §8, spec 04 v1.1 §A,
 * PRD Flow 3 step 1, P-6). Phase text comes from the registry, never a literal.
 */
const OPTIONS: Array<{ key: CapabilityKey; label: string; Icon: typeof Cloud }> = [
  { key: 'import.drive', label: 'Google Drive', Icon: HardDrive },
  { key: 'import.dropbox', label: 'Dropbox', Icon: Cloud },
  { key: 'import.sharepoint', label: 'SharePoint', Icon: FolderOpen },
  { key: 'ingest.docx', label: 'Word (.docx)', Icon: FileText },
  { key: 'ingest.ocr', label: 'Scanned / photo', Icon: ScanLine },
];

function phaseText(key: CapabilityKey): string {
  const c = getCapability(key);
  return c.status === 'planned' ? `Planned for ${c.phase}` : `Coming in ${c.phase}`;
}

export function ImportSourceOptions() {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-caption text-grey-500">Other ways to add a contract</p>
      <ul className="flex flex-wrap gap-2" aria-label="Import sources not yet available">
        {OPTIONS.map(({ key, label, Icon }) => {
          const id = `import-option-${key.replace('.', '-')}`;
          return (
            <li key={key}>
              <button
                type="button"
                aria-disabled="true"
                aria-describedby={`${id}-phase`}
                data-capability={key}
                onClick={(event) => event.preventDefault()}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') event.preventDefault();
                }}
                className="flex cursor-not-allowed flex-col items-start gap-0.5 rounded-card border border-grey-100 bg-grey-25 px-3 py-2 text-left text-grey-400"
              >
                <span className="flex items-center gap-1.5 text-caption text-grey-500">
                  <Icon aria-hidden="true" className="h-3.5 w-3.5" />
                  {label}
                </span>
                <span id={`${id}-phase`} className="text-caption text-grey-400">
                  {phaseText(key)}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      <Link href="/settings#capabilities" className="text-caption text-brand-700 underline">
        See what ContractIQ can do today
      </Link>
    </div>
  );
}
