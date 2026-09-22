import { describe, expect, it } from 'vitest';
import {
  KEY_DATE_SOURCE_TERMS,
  deriveKeyDatesFromTerms,
  nextRenewalOccurrence,
  parseIsoDate,
  parseLeadingInteger,
  sendAtFor,
} from '@/lib/services/reminder-service';

/** Spec 21 §7.2 — the derivation table, as pure logic. */

const t = (term_name: string, value: string | null, id = term_name) => ({ id, term_name, value });

describe('deriveKeyDatesFromTerms (MSA)', () => {
  it('end date + notice + renewal ⇒ end_date, renewal_notice_deadline, renewal_date (no auto_renewal_check)', () => {
    const { derived, unparsed } = deriveKeyDatesFromTerms('MSA', [
      t('Contract end date', '2027-03-31'),
      t('Notice to not auto renew (Days)', '30'),
      t('Auto Renewal', 'Yes'),
      t('Renewal Period (Months)', '12'),
    ]);
    expect(unparsed).toEqual([]);
    // D52 (5d-2b L10): the notice deadline is the lead-in to the RENEWAL, not
    // to the end date. Was 2027-03-01, anchored on the end date.
    expect(derived.map((d) => [d.kind, d.date.toISOString().slice(0, 10)])).toEqual([
      ['end_date', '2027-03-31'],
      ['renewal_notice_deadline', '2028-03-01'],
      ['renewal_date', '2028-03-31'],
    ]);
  });

  it('without the notice term ⇒ auto_renewal_check 90 days before the renewal', () => {
    const { derived } = deriveKeyDatesFromTerms('MSA', [
      t('Contract end date', '2027-03-31'),
      t('Auto Renewal', 'Yes'),
      t('Renewal Period (Months)', '12'),
    ]);
    expect(derived.map((d) => d.kind)).toEqual(['end_date', 'renewal_date', 'auto_renewal_check']);
    // D52 (5d-2b L10): 90 days before the renewal (2028-03-31). Was
    // 2026-12-31, 90 days before the end date.
    expect(derived.find((d) => d.kind === 'auto_renewal_check')!.date.toISOString().slice(0, 10)).toBe('2028-01-01');
  });

  it('an unparseable end date derives nothing and is reported', () => {
    const { derived, unparsed } = deriveKeyDatesFromTerms('MSA', [t('Contract end date', 'upon completion')]);
    expect(derived).toEqual([]);
    expect(unparsed).toEqual(['end_date']);
  });

  it('Auto Renewal = No derives no renewal_date and no auto check', () => {
    const { derived } = deriveKeyDatesFromTerms('MSA', [
      t('Contract end date', '2027-03-31'),
      t('Auto Renewal', 'No'),
      t('Renewal Period (Months)', '12'),
    ]);
    expect(derived.map((d) => d.kind)).toEqual(['end_date']);
  });
});

describe('deriveKeyDatesFromTerms (NDA)', () => {
  it('derives end_date from a Term & Duration value containing an ISO date', () => {
    const { derived } = deriveKeyDatesFromTerms('NDA', [t('Term & Duration', 'Two years, ending 2027-06-30')]);
    expect(derived.map((d) => [d.kind, d.date.toISOString().slice(0, 10)])).toEqual([['end_date', '2027-06-30']]);
  });
  it('derives nothing without a date', () => {
    expect(deriveKeyDatesFromTerms('NDA', [t('Term & Duration', 'Two years')]).derived).toEqual([]);
  });
});

describe('helpers', () => {
  it('parsers', () => {
    expect(parseIsoDate('2027-03-31')?.toISOString().slice(0, 10)).toBe('2027-03-31');
    expect(parseIsoDate('31 March 2027')).toBeNull();
    expect(parseLeadingInteger('30 days')).toBe(30);
    expect(parseLeadingInteger('N/A')).toBeNull();
  });
  it('send_at is date − offset at 08:00 UTC', () => {
    expect(sendAtFor(new Date(Date.UTC(2027, 2, 31)), 30).toISOString()).toBe('2027-03-01T08:00:00.000Z');
  });
  it('the source-term list is exported for the PATCH handler', () => {
    expect(KEY_DATE_SOURCE_TERMS.MSA).toContain('Contract end date');
    expect(KEY_DATE_SOURCE_TERMS.NDA).toEqual(['Term & Duration']);
  });
});

/**
 * L10 / D52 (spec 21 §7.2 amendment, 5d-2b). An auto-renewing contract whose
 * end date is years past kept showing the FIRST renewal as if it were
 * upcoming: live contract 93ba9b49 (Expel, ends 2022-09-21, renews every 6
 * months) showed "Renews on 21 Mar 2023" in September 2026. The renewal date
 * is now the first `end_date + k × period` that is still ahead, and the
 * auto-renewal check and notice deadline hang off that occurrence.
 */

const EXPEL = [
  t('Contract end date', '2022-09-21'),
  t('Auto Renewal', 'Yes'),
  t('Renewal Period (Months)', '6'),
];
const TODAY = new Date(Date.UTC(2026, 8, 22)); // 2026-09-22
const on = (derived: ReturnType<typeof deriveKeyDatesFromTerms>['derived'], kind: string) =>
  derived.find((d) => d.kind === kind)?.date.toISOString().slice(0, 10);

describe('renewal roll-forward (L10 / D52)', () => {
  it('rolls a long-past renewal forward to the next occurrence', () => {
    const { derived } = deriveKeyDatesFromTerms('MSA', EXPEL, TODAY);

    // 2022-09-21 + 9 × 6 months. The 8th (2026-09-21) is already yesterday.
    expect(on(derived, 'renewal_date')).toBe('2027-03-21');
  });

  it('hangs the auto-renewal check off the next renewal, not the original end', () => {
    const { derived } = deriveKeyDatesFromTerms('MSA', EXPEL, TODAY);

    expect(on(derived, 'auto_renewal_check')).toBe('2026-12-21');
  });

  it('leaves the end date itself in the past — it is a fact, not a schedule', () => {
    const { derived } = deriveKeyDatesFromTerms('MSA', EXPEL, TODAY);

    expect(on(derived, 'end_date')).toBe('2022-09-21');
  });

  it('treats an occurrence falling exactly today as the next one', () => {
    const { derived } = deriveKeyDatesFromTerms('MSA', EXPEL, new Date(Date.UTC(2026, 8, 21)));

    expect(on(derived, 'renewal_date')).toBe('2026-09-21');
  });

  it('does not roll forward when the first occurrence is already ahead', () => {
    const { derived } = deriveKeyDatesFromTerms(
      'MSA',
      [t('Contract end date', '2027-03-31'), t('Auto Renewal', 'Yes'), t('Renewal Period (Months)', '12')],
      TODAY,
    );

    expect(on(derived, 'renewal_date')).toBe('2028-03-31');
  });

  it('hangs the notice deadline off the next renewal', () => {
    const { derived } = deriveKeyDatesFromTerms(
      'MSA',
      [...EXPEL, t('Notice to not auto renew (Days)', '30')],
      TODAY,
    );

    // 2027-03-21 − 30 days.
    expect(on(derived, 'renewal_notice_deadline')).toBe('2027-02-19');
  });

  it('leaves a non-auto-renewing contract untouched', () => {
    const { derived } = deriveKeyDatesFromTerms(
      'MSA',
      [t('Contract end date', '2022-09-21'), t('Auto Renewal', 'No'), t('Renewal Period (Months)', '6')],
      TODAY,
    );

    expect(derived.map((d) => d.kind)).toEqual(['end_date']);
    expect(on(derived, 'end_date')).toBe('2022-09-21');
  });

  it('leaves an unparseable renewal period untouched and reports it', () => {
    const { derived, unparsed } = deriveKeyDatesFromTerms(
      'MSA',
      [t('Contract end date', '2022-09-21'), t('Auto Renewal', 'Yes'), t('Renewal Period (Months)', 'evergreen')],
      TODAY,
    );

    expect(unparsed).toContain('renewal_date');
    expect(derived.some((d) => d.kind === 'renewal_date')).toBe(false);
  });

  it('does not loop forever on a zero or negative period', () => {
    const { derived } = deriveKeyDatesFromTerms(
      'MSA',
      [t('Contract end date', '2022-09-21'), t('Auto Renewal', 'Yes'), t('Renewal Period (Months)', '0')],
      TODAY,
    );

    // Nothing to roll forward by: the date stays where the arithmetic puts it.
    expect(on(derived, 'renewal_date')).toBe('2022-09-21');
  });
});

describe('nextRenewalOccurrence (L10 / D52)', () => {
  it('advances by whole periods only', () => {
    const end = new Date(Date.UTC(2022, 8, 21));
    expect(nextRenewalOccurrence(end, 6, TODAY).toISOString().slice(0, 10)).toBe('2027-03-21');
  });

  it('returns the first occurrence when it is already ahead', () => {
    const end = new Date(Date.UTC(2027, 2, 31));
    expect(nextRenewalOccurrence(end, 12, TODAY).toISOString().slice(0, 10)).toBe('2028-03-31');
  });

  it('is stable for a period of zero', () => {
    const end = new Date(Date.UTC(2022, 8, 21));
    expect(nextRenewalOccurrence(end, 0, TODAY).toISOString().slice(0, 10)).toBe('2022-09-21');
  });
});
