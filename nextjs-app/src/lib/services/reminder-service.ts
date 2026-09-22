import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { recordEvent } from '@/lib/metrics/events';
import type { ContractType } from '@/types/domain';

/**
 * Key-date derivation (spec 21 §7.2, US-017 — `reminders.key_dates` stub:
 * the data layer is live, delivery is undeployed).
 *
 * Runs after persist_key_terms (spec 06 v1.1 §B step 11c) and after any edit
 * of a source term. Pure DB work on the caller's JWT; bounded to 1 s by the
 * caller; never fails the run.
 */

export type KeyDateKind = 'end_date' | 'renewal_notice_deadline' | 'renewal_date' | 'auto_renewal_check';

export const KEY_DATE_SOURCE_TERMS: Record<ContractType, string[]> = {
  MSA: ['Contract end date', 'Notice to not auto renew (Days)', 'Renewal Period (Months)', 'Auto Renewal'],
  NDA: ['Term & Duration'],
};

export const DEFAULT_OFFSETS_DAYS = [30, 60, 90] as const;
export const REMINDER_CHANNELS = ['email', 'in_app'] as const;
export const DERIVATION_BUDGET_MS = 1_000;

const ISO_DATE = /(\d{4})-(\d{2})-(\d{2})/;

export function parseIsoDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const m = value.match(ISO_DATE);
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return Number.isNaN(d.getTime()) ? null : d;
}

export function parseLeadingInteger(value: string | null | undefined): number | null {
  if (!value) return null;
  const m = value.match(/-?\d+/);
  return m ? Number(m[0]) : null;
}

function addDays(d: Date, days: number): Date {
  return new Date(d.getTime() + days * 86_400_000);
}
function addMonths(d: Date, months: number): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months, d.getUTCDate()));
}
function toDateString(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Days before the next renewal that an auto-renewal check is raised. */
export const AUTO_RENEWAL_CHECK_LEAD_DAYS = 90;

/**
 * D52 (spec 21 §7.2, 5d-2b L10): the next renewal still ahead of `today`.
 *
 * An auto-renewing contract does not renew once. Deriving `end_date + period`
 * and storing it meant a contract that has been rolling over for years still
 * advertised its FIRST renewal: live contract 93ba9b49 ends 2022-09-21 and
 * renews every 6 months, and in September 2026 the card offered "Renews on 21
 * Mar 2023" as an upcoming date with reminder toggles.
 *
 * Returns the first `end + k × period` (k ≥ 1) that is not before `today`. A
 * period of zero or less cannot advance, so it is returned as-is rather than
 * looped on.
 */
export function nextRenewalOccurrence(endDate: Date, periodMonths: number, today: Date): Date {
  if (periodMonths <= 0) return addMonths(endDate, periodMonths);

  const floor = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  let k = 1;
  let occurrence = addMonths(endDate, periodMonths);
  // Bounded: 1,200 periods is a century of monthly renewals.
  while (occurrence.getTime() < floor && k < 1_200) {
    k += 1;
    occurrence = addMonths(endDate, periodMonths * k);
  }
  return occurrence;
}
/** send_at = date − offset at 08:00 UTC. */
export function sendAtFor(date: Date, offsetDays: number): Date {
  const day = addDays(date, -offsetDays);
  return new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), 8, 0, 0));
}

export interface DerivedKeyDate {
  kind: KeyDateKind;
  date: Date;
  term_name: string;
  derived_from: Record<string, string>;
}

interface SourceTerm {
  id: string;
  term_name: string;
  value: string | null;
}

/** Pure derivation over the source terms (spec 21 §7.2 table). */
export function deriveKeyDatesFromTerms(
  contractType: ContractType,
  terms: SourceTerm[],
  /** D52: the clock the renewal roll-forward is measured against. */
  today: Date = new Date(),
): { derived: DerivedKeyDate[]; unparsed: KeyDateKind[] } {
  const byName = new Map(terms.map((t) => [t.term_name, t]));
  const derived: DerivedKeyDate[] = [];
  const unparsed: KeyDateKind[] = [];

  if (contractType === 'NDA') {
    const term = byName.get('Term & Duration');
    const date = parseIsoDate(term?.value);
    if (term?.value && !date) unparsed.push('end_date');
    if (date) derived.push({ kind: 'end_date', date, term_name: 'Term & Duration', derived_from: { 'Term & Duration': term!.value! } });
    return { derived, unparsed };
  }

  const endTerm = byName.get('Contract end date');
  const endDate = parseIsoDate(endTerm?.value);
  if (endTerm?.value && !endDate) unparsed.push('end_date');
  if (!endDate) return { derived, unparsed };
  derived.push({ kind: 'end_date', date: endDate, term_name: 'Contract end date', derived_from: { 'Contract end date': endTerm!.value! } });

  const noticeTerm = byName.get('Notice to not auto renew (Days)');
  const noticeDays = parseLeadingInteger(noticeTerm?.value);
  if (noticeTerm?.value && noticeDays === null) unparsed.push('renewal_notice_deadline');

  const autoTerm = byName.get('Auto Renewal');
  const autoRenews = /^yes\b/i.test((autoTerm?.value ?? '').trim());
  const periodTerm = byName.get('Renewal Period (Months)');
  const periodMonths = parseLeadingInteger(periodTerm?.value);
  if (periodTerm?.value && periodMonths === null) unparsed.push('renewal_date');

  // D52: for an auto-renewing contract the live renewal is the next
  // occurrence, and the notice deadline and auto-renewal check are the lead-in
  // to THAT date. Without a parseable period there is no series to roll along,
  // so both fall back to the end date as before.
  const rollsForward = autoRenews && periodMonths !== null;
  const renewalDate = rollsForward ? nextRenewalOccurrence(endDate, periodMonths, today) : null;
  const anchor = renewalDate ?? endDate;

  if (noticeDays !== null) {
    derived.push({
      kind: 'renewal_notice_deadline',
      date: addDays(anchor, -noticeDays),
      term_name: 'Notice to not auto renew (Days)',
      derived_from: { 'Contract end date': endTerm!.value!, 'Notice to not auto renew (Days)': noticeTerm!.value! },
    });
  }

  if (renewalDate) {
    derived.push({
      kind: 'renewal_date',
      date: renewalDate,
      term_name: 'Renewal Period (Months)',
      derived_from: { 'Contract end date': endTerm!.value!, 'Renewal Period (Months)': periodTerm!.value!, 'Auto Renewal': autoTerm!.value! },
    });
  }
  if (autoRenews && noticeDays === null) {
    derived.push({
      kind: 'auto_renewal_check',
      date: addDays(anchor, -AUTO_RENEWAL_CHECK_LEAD_DAYS),
      term_name: 'Auto Renewal',
      derived_from: { 'Contract end date': endTerm!.value!, 'Auto Renewal': autoTerm!.value! },
    });
  }
  return { derived, unparsed };
}

/**
 * Derives and persists key dates + default reminders for a contract on the
 * caller's JWT. Upserts on (contract_id, kind); a manual row is never
 * overwritten; derived kinds no longer applicable are removed; each written
 * key date replaces its scheduled reminders with 30/60/90 × email/in_app.
 */
export async function deriveKeyDates(
  supabase: SupabaseClient,
  contractId: string,
  userId: string,
  contractType: ContractType,
): Promise<{ written: KeyDateKind[]; unparsed: KeyDateKind[] }> {
  const names = KEY_DATE_SOURCE_TERMS[contractType];
  const { data: rows } = await supabase
    .from('key_terms')
    .select('id, term_name, value')
    .eq('contract_id', contractId)
    .in('term_name', names);
  const terms = (rows ?? []) as SourceTerm[];
  const { derived, unparsed } = deriveKeyDatesFromTerms(contractType, terms);

  for (const kind of unparsed) {
    await recordEvent(supabase, { userId, contractId, eventType: 'key_date_unparsed', metadata: { kind } });
  }

  const { data: existing } = await supabase
    .from('key_dates')
    .select('id, kind, is_manual')
    .eq('contract_id', contractId);
  const existingByKind = new Map((existing ?? []).map((k) => [k.kind as KeyDateKind, k]));
  const derivedKinds = new Set(derived.map((d) => d.kind));

  // Remove derived rows whose kind no longer applies (never manual ones).
  const stale = (existing ?? []).filter((k) => !k.is_manual && !derivedKinds.has(k.kind as KeyDateKind));
  if (stale.length > 0) {
    await supabase.from('key_dates').delete().in('id', stale.map((k) => k.id));
  }

  const written: KeyDateKind[] = [];
  const termIdByName = new Map(terms.map((t) => [t.term_name, t.id]));
  for (const d of derived) {
    const current = existingByKind.get(d.kind);
    if (current?.is_manual) continue;
    const { data: upserted } = await supabase
      .from('key_dates')
      .upsert(
        {
          contract_id: contractId,
          user_id: userId,
          kind: d.kind,
          date: toDateString(d.date),
          term_id: termIdByName.get(d.term_name) ?? null,
          derived_from: d.derived_from,
          is_manual: false,
        },
        { onConflict: 'contract_id,kind' },
      )
      .select('id')
      .single();
    if (!upserted) continue;
    await replaceReminders(supabase, upserted.id, userId, d.date, [...DEFAULT_OFFSETS_DAYS]);
    written.push(d.kind);
  }
  return { written, unparsed };
}

/** Cancels scheduled reminders for a key date and inserts the requested offsets. */
export async function replaceReminders(
  supabase: SupabaseClient,
  keyDateId: string,
  userId: string,
  date: Date,
  offsets: number[],
): Promise<void> {
  await supabase
    .from('reminders')
    .delete()
    .eq('key_date_id', keyDateId)
    .in('status', ['scheduled', 'cancelled']);
  if (offsets.length === 0) return;
  const now = Date.now();
  const rows = offsets.flatMap((offset) =>
    REMINDER_CHANNELS.map((channel) => {
      const sendAt = sendAtFor(date, offset);
      return {
        key_date_id: keyDateId,
        user_id: userId,
        offset_days: offset,
        send_at: sendAt.toISOString(),
        channel,
        status: sendAt.getTime() < now ? 'cancelled' : 'scheduled',
      };
    }),
  );
  await supabase.from('reminders').upsert(rows, { onConflict: 'key_date_id,offset_days,channel' });
}

/** Bounded wrapper for step 11c: never throws, never exceeds the budget by more than the in-flight query. */
export async function deriveKeyDatesBounded(
  supabase: SupabaseClient,
  contractId: string,
  userId: string,
  contractType: ContractType,
  budgetMs = DERIVATION_BUDGET_MS,
): Promise<void> {
  try {
    await Promise.race([
      deriveKeyDates(supabase, contractId, userId, contractType),
      new Promise<void>((resolve) => setTimeout(resolve, budgetMs)),
    ]);
  } catch (err) {
    console.warn(JSON.stringify({ key_dates: 'derivation_failed', contractId, reason: err instanceof Error ? err.message : String(err) }));
  }
}
