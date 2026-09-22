'use client';

import { useEffect, useState } from 'react';
import { PageChip } from './PageChip';
import { getCapability } from '@/lib/capabilities';
import { formatDate } from '@/lib/utils/format';
import type { KeyDate, KeyDateKind, KeyTerm } from '@/types/domain';

/**
 * Key dates + reminder offsets (spec 21 §7.4, US-017). The data layer is live
 * while `reminders.key_dates` is a stub — only delivery is undeployed, so the
 * card renders with the stub note (`<Capability stub="children">` semantics).
 */
const LABELS: Record<KeyDateKind, string> = {
  end_date: 'Contract ends',
  renewal_notice_deadline: 'Last day to stop auto-renewal',
  renewal_date: 'Renews on',
  auto_renewal_check: 'Auto-renewal check',
};
const OFFSETS = [30, 60, 90] as const;

export function KeyDatesCard({
  contractId,
  initialKeyDates,
  terms,
}: {
  contractId: string;
  initialKeyDates?: KeyDate[];
  terms: KeyTerm[];
}) {
  const [keyDates, setKeyDates] = useState<KeyDate[] | null>(initialKeyDates ?? null);
  const [saving, setSaving] = useState<string | null>(null);
  const capability = getCapability('reminders.key_dates');
  const hidden = capability.status === 'planned';

  useEffect(() => {
    if (hidden || keyDates !== null) return;
    let cancelled = false;
    fetch(`/api/contracts/${contractId}/key-dates`)
      .then(async (res) => (res.ok ? ((await res.json()) as { key_dates: KeyDate[] }).key_dates : []))
      .then((list) => {
        if (!cancelled) setKeyDates(list);
      })
      .catch(() => {
        if (!cancelled) setKeyDates([]);
      });
    return () => {
      cancelled = true;
    };
  }, [contractId, keyDates, hidden]);

  if (hidden) return null;

  async function toggle(kd: KeyDate, offset: number): Promise<void> {
    const current = new Set(kd.reminders.filter((r) => r.status !== 'cancelled').map((r) => r.offset_days));
    if (current.has(offset)) current.delete(offset);
    else current.add(offset);
    setSaving(kd.id);
    try {
      const res = await fetch(`/api/key-dates/${kd.id}/reminders`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ offsets_days: [...current].sort((a, b) => a - b) }),
      });
      if (res.ok) {
        const body = (await res.json()) as { reminders: KeyDate['reminders'] };
        setKeyDates((list) => (list ?? []).map((k) => (k.id === kd.id ? { ...k, reminders: body.reminders } : k)));
      }
    } finally {
      setSaving(null);
    }
  }

  const termById = new Map(terms.map((t) => [t.id, t]));

  return (
    <section aria-label="Key dates" className="mt-subsection flex flex-col gap-2 rounded-card border border-grey-100 p-4">
      <h2 className="text-h5 text-grey-900">Key dates</h2>
      {keyDates === null ? (
        <p className="text-caption text-grey-400">Loading…</p>
      ) : keyDates.length === 0 ? (
        <p className="text-caption text-grey-400">No key dates were found in this contract.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-grey-50">
          {keyDates.map((kd) => {
            const term = kd.term_id ? termById.get(kd.term_id) : undefined;
            const active = new Set(kd.reminders.filter((r) => r.status !== 'cancelled').map((r) => r.offset_days));
            return (
              <li key={kd.id} className="flex flex-col gap-1 py-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-body text-grey-900">
                    {LABELS[kd.kind]} · {formatDate(kd.date)}
                  </span>
                  {term && <PageChip pageNumber={term.page_number} sourceSentence={term.source_sentence} />}
                </div>
                <div className="flex items-center gap-2" role="group" aria-label={`Reminders for ${LABELS[kd.kind]}`}>
                  <span className="text-caption text-grey-400">Remind me</span>
                  {OFFSETS.map((offset) => (
                    <button
                      key={offset}
                      type="button"
                      role="switch"
                      aria-checked={active.has(offset)}
                      disabled={saving === kd.id}
                      onClick={() => void toggle(kd, offset)}
                      className={`rounded-badge px-2 py-0.5 text-caption ${
                        active.has(offset) ? 'bg-brand-50 text-brand-700' : 'bg-grey-50 text-grey-500'
                      }`}
                    >
                      {offset} days before
                    </button>
                  ))}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {capability.status === 'stub' && (
        <p className="text-caption text-grey-400">
          Email reminders arrive in v1.1 — in-app reminders are shown in the bell today.
        </p>
      )}
    </section>
  );
}
