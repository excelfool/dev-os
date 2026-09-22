import type { SupabaseClient } from '@supabase/supabase-js';

/** Route 29 / GET contract shape (spec 21 §5). Shared by both routes. */
export interface KeyDateView {
  id: string;
  kind: string;
  date: string;
  term_id: string | null;
  term_name: string | null;
  is_manual: boolean;
  reminders: Array<{ id: string; offset_days: number; send_at: string; status: string; channel: string }>;
}

export async function listKeyDates(supabase: SupabaseClient, contractId: string): Promise<KeyDateView[]> {
  const { data: dates } = await supabase
    .from('key_dates')
    .select('id, kind, date, term_id, is_manual, derived_from')
    .eq('contract_id', contractId)
    .order('date', { ascending: true });
  if (!dates || dates.length === 0) return [];

  const ids = dates.map((d) => d.id);
  const termIds = dates.map((d) => d.term_id).filter((t): t is string => typeof t === 'string');
  const [{ data: reminders }, { data: terms }] = await Promise.all([
    supabase
      .from('reminders')
      .select('id, key_date_id, offset_days, send_at, status, channel')
      .in('key_date_id', ids)
      .order('offset_days', { ascending: true }),
    termIds.length > 0
      ? supabase.from('key_terms').select('id, term_name').in('id', termIds)
      : Promise.resolve({ data: [] as Array<{ id: string; term_name: string }> }),
  ]);
  const termName = new Map((terms ?? []).map((t) => [t.id, t.term_name as string]));

  return dates.map((d) => ({
    id: d.id,
    kind: d.kind,
    date: d.date,
    term_id: d.term_id ?? null,
    term_name: d.term_id ? (termName.get(d.term_id) ?? null) : null,
    is_manual: Boolean(d.is_manual),
    reminders: (reminders ?? [])
      .filter((r) => r.key_date_id === d.id)
      .map((r) => ({ id: r.id, offset_days: r.offset_days, send_at: r.send_at, status: r.status, channel: r.channel })),
  }));
}
