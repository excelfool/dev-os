/**
 * The renewal series: one definition, shared by the derivation
 * (`reminder-service`) and the read-time roll (`key-date-rollforward`), so the
 * two can never drift (spec 21 §7.2, D52 as corrected 5d-2c).
 *
 * Pure and free of `server-only`: the card applies the same roll the API does.
 */

/**
 * Adds months, clamping to the last day of the target month (5d-2c).
 *
 * `Date.UTC(y, m + n, 31)` rolls over — 31 January plus one month would become
 * 3 March — which moves a renewal past the day the contract actually renews.
 * Each occurrence is measured from the END DATE, never from the previous
 * occurrence, so a clamp never compounds: 31 January plus one month is 28
 * February, and plus two months is 31 March again.
 */
export function addMonthsClamped(date: Date, months: number): Date {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + months;
  const day = date.getUTCDate();
  // Day 0 of the following month is the last day of this one.
  const lastDayOfTarget = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return new Date(Date.UTC(year, month, Math.min(day, lastDayOfTarget)));
}

/** Midnight UTC on `today`, so a date falling today still counts as ahead. */
export function startOfDayUtc(today: Date): number {
  return Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
}

/** A renewal series longer than this is a misparse, not a contract. */
const MAX_PERIODS = 1_200;

/**
 * The renewal the contract is actually facing: the first
 * `end_date + k × period` with **k ≥ 0** that is not before `today`.
 *
 * k ≥ 0 matters. The anchor is the end of the CURRENT term, not the term
 * after it. A contract ending 2027-03-31 renews on 2027-03-31 — that is the
 * date the reader must act before — so notice and the auto-renewal check are
 * counted back from it. Starting at k = 1 would have told a reader whose term
 * ends next March that their notice deadline was a year later, which is the
 * one mistake this date is on screen to prevent. For a contract that has been
 * renewing for years the same rule skips the occurrences already behind us.
 *
 * A period of zero or less cannot advance; the end date is returned.
 */
export function nextRenewalOccurrence(endDate: Date, periodMonths: number, today: Date): Date {
  if (periodMonths <= 0) return endDate;

  const floor = startOfDayUtc(today);
  let k = 0;
  let occurrence = endDate;
  while (occurrence.getTime() < floor && k < MAX_PERIODS) {
    k += 1;
    occurrence = addMonthsClamped(endDate, periodMonths * k);
  }
  return occurrence;
}
