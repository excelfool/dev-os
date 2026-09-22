// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { KeyDatesCard } from '@/components/terms/KeyDatesCard';
import type { KeyDate } from '@/types/domain';

/**
 * Spec 21 §7.4 with the 5d-2c anchor. Two things the card must get right once
 * the renewal is anchored on the end of the CURRENT term:
 *
 * 1. While a contract is in its first term, "Contract ends" and "Renews on"
 *    are the same day — the term ends and, unless notice is given, it renews.
 *    Two rows bearing one date read as a data error, so they become one row.
 * 2. A date still behind today after the roll is history, and carries no
 *    reminder toggles.
 */

vi.mock('@/lib/capabilities', () => ({
  getCapability: () => ({ status: 'stub', key: 'reminders.key_dates' }),
}));

const REMINDERS: KeyDate['reminders'] = [
  { id: 'r1', offset_days: 30, send_at: '2027-03-01T08:00:00Z', status: 'scheduled', channel: 'email' },
];

function keyDate(kind: KeyDate['kind'], date: string, derived: Record<string, unknown>): KeyDate {
  return {
    id: `${kind}-${date}`,
    kind,
    date,
    term_id: null,
    term_name: null,
    is_manual: false,
    derived_from: derived,
    reminders: REMINDERS,
  };
}

function renderCard(keyDates: KeyDate[]) {
  return render(<KeyDatesCard contractId="c1" initialKeyDates={keyDates} terms={[]} />);
}

afterEach(cleanup);

describe('first term: end and renewal are the same day (5d-2c)', () => {
  const FIRST_TERM = [
    keyDate('end_date', '2027-03-31', { 'Contract end date': '2027-03-31' }),
    keyDate('renewal_date', '2027-03-31', {
      'Contract end date': '2027-03-31',
      'Renewal Period (Months)': '12',
      'Auto Renewal': 'Yes',
    }),
  ];

  it('renders one combined row, not two with the same date', () => {
    renderCard(FIRST_TERM);

    expect(screen.getByText(/Term ends and auto-renews · 31 Mar 2027/)).toBeTruthy();
    expect(screen.queryByText(/Contract ends ·/)).toBeNull();
    expect(screen.queryByText(/Renews on ·/)).toBeNull();
  });

  it('keeps the reminder toggles on the combined row', () => {
    renderCard(FIRST_TERM);

    expect(screen.getAllByRole('switch')).toHaveLength(3);
  });
});

describe('a contract that has been renewing for years (5d-2c)', () => {
  // Expel: ended 2022-09-21, renews every 6 months.
  const EXPEL = [
    keyDate('end_date', '2022-09-21', { 'Contract end date': '2022-09-21' }),
    keyDate('renewal_date', '2023-03-21', {
      'Contract end date': '2022-09-21',
      'Renewal Period (Months)': '6',
      'Auto Renewal': 'Yes',
    }),
    keyDate('auto_renewal_check', '2022-06-23', {
      'Contract end date': '2022-09-21',
      'Auto Renewal': 'Yes',
    }),
  ];

  it('keeps the two rows separate when the dates differ', () => {
    renderCard(EXPEL);

    expect(screen.getByText(/Contract ends · 21 Sep 2022/)).toBeTruthy();
    expect(screen.getByText(/Renews on · 21 Mar 2027/)).toBeTruthy();
    expect(screen.queryByText(/Term ends and auto-renews/)).toBeNull();
  });

  it('rolls the auto-renewal check forward with the renewal', () => {
    renderCard(EXPEL);

    expect(screen.getByText(/Auto-renewal check · 21 Dec 2026/)).toBeTruthy();
  });

  it('marks the passed end date and drops its reminder toggles', () => {
    renderCard(EXPEL);

    expect(screen.getByText('Passed')).toBeTruthy();
    // Only the two upcoming rows keep their toggles.
    expect(screen.getAllByRole('switch')).toHaveLength(6);
  });
});

describe('a contract that does not auto-renew', () => {
  it('shows the end date alone, with no combined row', () => {
    renderCard([keyDate('end_date', '2027-03-31', { 'Contract end date': '2027-03-31' })]);

    expect(screen.getByText(/Contract ends · 31 Mar 2027/)).toBeTruthy();
    expect(screen.queryByText(/Term ends and auto-renews/)).toBeNull();
  });
});
