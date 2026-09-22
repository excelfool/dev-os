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

/** A bare calendar date, with no time and no zone: `2022-09-21`. */
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * "d MMM yyyy" for a DATE-ONLY value, with no timezone shift (L9, spec 07
 * v1.1 5d-2b).
 *
 * `key_dates.date` is a calendar date: `2022-09-21` means the 21st, in no
 * zone at all. `new Date('2022-09-21')` parses it as UTC midnight, and
 * rendering that in local time moves it backwards anywhere west of Greenwich —
 * the live card showed "20 Sep 2022" to a viewer in UTC−4. Building the Date
 * from the parts and formatting in UTC keeps the day the user stored.
 *
 * This is the single helper for every date-only value on screen.
 */
export function formatDateOnly(value: string): string {
  const [year, month, day] = value.slice(0, 10).split('-').map(Number);
  if (!year || !month || !day) return value;
  // Local midnight, formatted locally: the parts go in and come back out
  // unchanged, whatever zone the reader is in. No UTC is involved, so there
  // is no offset to lose the day to.
  return format(new Date(year, month - 1, day), 'd MMM yyyy');
}

/**
 * "d MMM yyyy" (spec 09 §2). A date-only string goes through
 * `formatDateOnly`; a full timestamp is rendered in the reader's local zone,
 * which is what an upload time should do.
 */
export function formatDate(value: string | Date): string {
  if (typeof value === 'string' && DATE_ONLY.test(value.trim())) return formatDateOnly(value.trim());
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
