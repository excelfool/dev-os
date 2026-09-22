import { describe, expect, it } from 'vitest';
import { isPast, rollForwardKeyDates } from '@/lib/services/key-date-rollforward';

/**
 * L10 / D52 read path (spec 21 §7.2 as amended 5d-2b). Derivation computes the
 * next renewal, but a stored row ages: contract 93ba9b49 was derived in 2022
 * and read in 2026, by which time its stored renewal (2023-03-21) was three
 * years behind. Route 29 and the card both roll the series forward on read, so
 * a passed date is never presented as upcoming.
 */

const TODAY = new Date(Date.UTC(2026, 8, 22)); // 2026-09-22

/** The live Expel rows, exactly as `key_dates` holds them. */
const EXPEL = [
  {
    kind: 'end_date',
    date: '2022-09-21',
    is_manual: false,
    derived_from: { 'Contract end date': '2022-09-21' },
  },
  {
    kind: 'renewal_date',
    date: '2023-03-21',
    is_manual: false,
    derived_from: {
      'Contract end date': '2022-09-21',
      'Renewal Period (Months)': '6',
      'Auto Renewal': 'Yes',
    },
  },
  {
    kind: 'auto_renewal_check',
    date: '2022-06-23',
    is_manual: false,
    derived_from: { 'Contract end date': '2022-09-21', 'Auto Renewal': 'Yes' },
  },
];

const dateOf = (rows: Array<{ kind: string; date: string }>, kind: string) =>
  rows.find((r) => r.kind === kind)?.date;

describe('rollForwardKeyDates (L10 / D52)', () => {
  it('rolls the stored renewal to the next occurrence still ahead', () => {
    const rolled = rollForwardKeyDates(EXPEL, TODAY);

    expect(dateOf(rolled, 'renewal_date')).toBe('2027-03-21');
  });

  it('moves the auto-renewal check with it', () => {
    const rolled = rollForwardKeyDates(EXPEL, TODAY);

    expect(dateOf(rolled, 'auto_renewal_check')).toBe('2026-12-21');
  });

  it('leaves the end date where it is — the contract really did end then', () => {
    const rolled = rollForwardKeyDates(EXPEL, TODAY);

    expect(dateOf(rolled, 'end_date')).toBe('2022-09-21');
  });

  it('moves a notice deadline by its own notice period', () => {
    const rolled = rollForwardKeyDates(
      [
        ...EXPEL,
        {
          kind: 'renewal_notice_deadline',
          date: '2023-02-19',
          is_manual: false,
          derived_from: { 'Contract end date': '2022-09-21', 'Notice to not auto renew (Days)': '30' },
        },
      ],
      TODAY,
    );

    expect(dateOf(rolled, 'renewal_notice_deadline')).toBe('2027-02-19');
  });

  it('returns the rows untouched when the stored renewal is already next', () => {
    const rows = rollForwardKeyDates(EXPEL, TODAY);

    expect(rollForwardKeyDates(rows, TODAY)).toBe(rows);
  });

  it('never rewrites a date the user set by hand', () => {
    const manual = EXPEL.map((r) => (r.kind === 'renewal_date' ? { ...r, is_manual: true } : r));

    expect(dateOf(rollForwardKeyDates(manual, TODAY), 'renewal_date')).toBe('2023-03-21');
  });

  it('leaves a contract with no renewal row alone', () => {
    const rows = [EXPEL[0]!];

    expect(rollForwardKeyDates(rows, TODAY)).toBe(rows);
  });

  it('anchors on the end date itself while the contract is in its first term (5d-2c)', () => {
    // Derived before 5d-2c, so the stored renewal is a year past the end date.
    const firstTerm = [
      {
        kind: 'end_date',
        date: '2027-03-31',
        is_manual: false,
        derived_from: { 'Contract end date': '2027-03-31' },
      },
      {
        kind: 'renewal_date',
        date: '2028-03-31',
        is_manual: false,
        derived_from: {
          'Contract end date': '2027-03-31',
          'Renewal Period (Months)': '12',
          'Auto Renewal': 'Yes',
        },
      },
      {
        kind: 'renewal_notice_deadline',
        date: '2028-03-01',
        is_manual: false,
        derived_from: { 'Contract end date': '2027-03-31', 'Notice to not auto renew (Days)': '30' },
      },
    ];

    const rolled = rollForwardKeyDates(firstTerm, TODAY);

    expect(dateOf(rolled, 'renewal_date')).toBe('2027-03-31');
    expect(dateOf(rolled, 'renewal_notice_deadline')).toBe('2027-03-01');
  });

  it('clamps a month-end renewal to a real day (5d-2c)', () => {
    const monthEnd = [
      {
        kind: 'renewal_date',
        date: '2026-08-31',
        is_manual: false,
        derived_from: {
          'Contract end date': '2026-08-31',
          'Renewal Period (Months)': '6',
          'Auto Renewal': 'Yes',
        },
      },
    ];

    // 2026-08-31 is behind us; + 6 months clamps to the end of February.
    expect(dateOf(rollForwardKeyDates(monthEnd, TODAY), 'renewal_date')).toBe('2027-02-28');
  });

  it('leaves a renewal whose period cannot be read alone', () => {
    const rows = EXPEL.map((r) =>
      r.kind === 'renewal_date'
        ? { ...r, derived_from: { ...r.derived_from, 'Renewal Period (Months)': 'evergreen' } }
        : r,
    );

    expect(dateOf(rollForwardKeyDates(rows, TODAY), 'renewal_date')).toBe('2023-03-21');
  });
});

describe('isPast (L10 / D52)', () => {
  it('is true for a date behind today', () => {
    expect(isPast('2022-09-21', TODAY)).toBe(true);
  });

  it('is false for today itself', () => {
    expect(isPast('2026-09-22', TODAY)).toBe(false);
  });

  it('is false for a date ahead', () => {
    expect(isPast('2027-03-21', TODAY)).toBe(false);
  });
});
