// Set BEFORE anything constructs a Date, so the process really is in a
// negative-offset zone — the condition that produced the live bug.
process.env.TZ = 'America/New_York';

import { describe, expect, it } from 'vitest';
import { formatDate, formatDateOnly } from '@/lib/utils/format';

/**
 * L9 (spec 07 v1.1 5d-2b). `key_dates.date` is a calendar date — `2022-09-21`
 * means the 21st, in no timezone. `new Date('2022-09-21')` parses it as UTC
 * midnight, and formatting that in a negative-offset zone renders the previous
 * day: the live card showed 20 Sep 2022 for a stored 2022-09-21 (viewer in
 * UTC−4). A date-only value must never be shifted.
 */

describe('the test process really is in a negative-offset zone', () => {
  it('renders UTC midnight as the previous local day', () => {
    // If this fails, the assertions below prove nothing — the bug only
    // appears west of Greenwich.
    expect(new Date('2022-09-21T00:00:00Z').getDate()).toBe(20);
  });
});

describe('formatDateOnly (L9)', () => {
  it.each([
    ['2022-09-21', '21 Sep 2022'],
    ['2023-03-21', '21 Mar 2023'],
    ['2022-06-23', '23 Jun 2022'],
    ['2027-03-21', '21 Mar 2027'],
    ['2026-12-21', '21 Dec 2026'],
  ])('renders %s as %s', (iso, expected) => {
    expect(formatDateOnly(iso)).toBe(expected);
  });

  it('does not shift a date at the start of a month', () => {
    expect(formatDateOnly('2026-01-01')).toBe('1 Jan 2026');
  });

  it('does not shift a leap day', () => {
    expect(formatDateOnly('2024-02-29')).toBe('29 Feb 2024');
  });
});

describe('formatDate routes a date-only value through the same path (L9)', () => {
  it.each([
    ['2022-09-21', '21 Sep 2022'],
    ['2023-03-21', '21 Mar 2023'],
    ['2022-06-23', '23 Jun 2022'],
  ])('renders the date-only string %s as %s', (iso, expected) => {
    expect(formatDate(iso)).toBe(expected);
  });

  it('still renders a full timestamp in local time', () => {
    // An upload at 20:30 UTC is still the 21st locally (16:30 EDT).
    expect(formatDate('2026-09-21T20:30:00Z')).toBe('21 Sep 2026');
  });

  it('still accepts a Date object', () => {
    expect(formatDate(new Date(2026, 8, 21, 12))).toBe('21 Sep 2026');
  });
});
