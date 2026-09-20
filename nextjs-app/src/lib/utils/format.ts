import { format } from 'date-fns';
import type { ConfidenceBand } from '@/types/domain';

/**
 * The single confidence-band definition (spec 06 §6). Colour is never the only
 * channel — every surface pairs the band with an icon and text.
 */
export function confidenceBand(score: number): ConfidenceBand {
  if (score >= 80) return 'high';
  if (score >= 50) return 'medium';
  return 'low';
}

export const CONFIDENCE_BAND_STYLES: Record<
  ConfidenceBand,
  { text: string; background: string; label: (score: number) => string }
> = {
  high: {
    text: 'text-success-700',
    background: 'bg-success-50',
    label: (score) => `${score}% confidence`,
  },
  medium: {
    text: 'text-warning-900',
    background: 'bg-warning-100',
    label: (score) => `${score}% confidence`,
  },
  low: {
    text: 'text-danger-700',
    background: 'bg-danger-50',
    label: (score) => `${score}% confidence — verify this`,
  },
};

export const LOW_CONFIDENCE_TOOLTIP =
  'Low confidence — we recommend verifying this in the document directly.';

/** "d MMM yyyy" — the dashboard's upload-date format (spec 09 §2). */
export function formatDate(value: string | Date): string {
  return format(typeof value === 'string' ? new Date(value) : value, 'd MMM yyyy');
}

/** Megabytes to one decimal, for the FILE_TOO_LARGE message. */
export function formatMegabytes(bytes: number): string {
  return (bytes / (1024 * 1024)).toFixed(1);
}

/**
 * Sanitises a filename before it becomes a Storage path (spec 02 §6). The
 * original is stored unmodified in `contracts.file_name` for display.
 */
export function sanitiseFilename(name: string): string {
  const base = name.normalize('NFKC').replace(/\.pdf$/i, '');
  const safe = base
    .replace(/[^A-Za-z0-9._-]/g, '_')
    .replace(/_{2,}/g, '_')
    .slice(0, 100);
  return `${safe || 'contract'}.pdf`;
}
