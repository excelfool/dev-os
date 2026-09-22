import { describe, expect, it } from 'vitest';
import {
  KEY_DATE_SOURCE_TERMS,
  deriveKeyDatesFromTerms,
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
    expect(derived.map((d) => [d.kind, d.date.toISOString().slice(0, 10)])).toEqual([
      ['end_date', '2027-03-31'],
      ['renewal_notice_deadline', '2027-03-01'],
      ['renewal_date', '2028-03-31'],
    ]);
  });

  it('without the notice term ⇒ auto_renewal_check at end − 90 days', () => {
    const { derived } = deriveKeyDatesFromTerms('MSA', [
      t('Contract end date', '2027-03-31'),
      t('Auto Renewal', 'Yes'),
      t('Renewal Period (Months)', '12'),
    ]);
    expect(derived.map((d) => d.kind)).toEqual(['end_date', 'renewal_date', 'auto_renewal_check']);
    expect(derived.find((d) => d.kind === 'auto_renewal_check')!.date.toISOString().slice(0, 10)).toBe('2026-12-31');
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
