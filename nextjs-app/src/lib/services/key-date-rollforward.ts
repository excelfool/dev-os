/**
 * Read-time renewal roll-forward (D52, spec 21 §7.2 as amended 5d-2b L10).
 *
 * Derivation computes the next renewal, but a stored row ages: a contract
 * derived in March is read again in October, by which time the renewal it
 * named may have passed. Reminders beyond the next occurrence would need a
 * scheduled job to keep rolling (recorded as a Stage 10 item), so until that
 * exists the READ path is what guarantees a passed date is never presented as
 * upcoming.
 *
 * Pure, and deliberately free of `server-only`: route 29 and the card both
 * apply it, so the API and the UI can never disagree about which renewal is
 * next.
 */

export interface RollForwardRow {
  kind: string;
  date: string;
  is_manual?: boolean;
  derived_from?: Record<string, unknown> | null;
}

import { nextRenewalOccurrence, startOfDayUtc as startOfDay } from './renewal-schedule';

const ISO_DATE = /(\d{4})-(\d{2})-(\d{2})/;

function parseIso(value: string | null | undefined): Date | null {
  if (!value) return null;
  const m = String(value).match(ISO_DATE);
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return Number.isNaN(d.getTime()) ? null : d;
}

function leadingInteger(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const m = value.match(/-?\d+/);
  return m ? Number(m[0]) : null;
}

function toDateString(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export { startOfDayUtc } from './renewal-schedule';

/** True when a date-only value is strictly before today. */
export function isPast(date: string, today: Date = new Date()): boolean {
  const parsed = parseIso(date);
  return parsed !== null && parsed.getTime() < startOfDay(today);
}

/**
 * Rolls a stored renewal series forward. Returns a new array; rows that need
 * no change are returned untouched, and a manual row is never rewritten —
 * the user's own date outranks the derivation.
 */
export function rollForwardKeyDates<T extends RollForwardRow>(rows: T[], today: Date = new Date()): T[] {
  const renewal = rows.find((r) => r.kind === 'renewal_date' && !r.is_manual);
  if (!renewal) return rows;

  const endDate = parseIso(renewal.derived_from?.['Contract end date'] as string | undefined);
  const periodMonths = leadingInteger(renewal.derived_from?.['Renewal Period (Months)']);
  if (!endDate || periodMonths === null || periodMonths <= 0) return rows;

  // 5d-2c: k ≥ 0 — the end of the current term is itself a renewal.
  const next = nextRenewalOccurrence(endDate, periodMonths, today);

  const stored = parseIso(renewal.date);
  // Already the next occurrence — leave every row exactly as it is.
  if (stored && stored.getTime() === next.getTime()) return rows;

  const shiftDays = (days: number) => toDateString(new Date(next.getTime() - days * 86_400_000));

  return rows.map((row) => {
    if (row.is_manual) return row;
    if (row.kind === 'renewal_date') return { ...row, date: toDateString(next) };
    if (row.kind === 'auto_renewal_check') return { ...row, date: shiftDays(90) };
    if (row.kind === 'renewal_notice_deadline') {
      const noticeDays = leadingInteger(row.derived_from?.['Notice to not auto renew (Days)']);
      return noticeDays === null ? row : { ...row, date: shiftDays(noticeDays) };
    }
    // end_date is a fact about the contract, not a schedule. It stays put.
    return row;
  });
}
