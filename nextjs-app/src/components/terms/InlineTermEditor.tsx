'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Input } from '@/components/ui/input';
import { createBrowserSupabaseClient } from '@/lib/supabase/client';
import { recordEvent } from '@/lib/metrics/events';

/**
 * Inline editing (US-009, spec 07 §5). Enter saves, Esc cancels, blur saves.
 * Optimistic with rollback; the measured duration is the evidence for the ≤2s
 * target.
 */
export function InlineTermEditor({
  termId,
  userId,
  contractId,
  value,
  onSaved,
}: {
  termId: string;
  userId: string;
  contractId: string;
  value: string | null;
  onSaved: (next: string) => void;
}) {
  const supabase = useMemo(() => createBrowserSupabaseClient(), []);
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? '');
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  /**
   * `autoFocus` is silently ignored on a disabled input. Reopening the editor
   * while the previous save is still in flight therefore mounted it disabled,
   * skipped the autofocus, and never focused it once it enabled — the editor
   * was open with focus nowhere, which strands a keyboard user (spec 16 §7).
   * Focusing from an effect covers both the plain case and that one.
   */
  useEffect(() => {
    if (isEditing && !isSaving) inputRef.current?.focus();
  }, [isEditing, isSaving]);

  async function save() {
    const next = draft.trim();
    if (next === (value ?? '')) {
      setIsEditing(false);
      return;
    }
    if (next.length < 1 || next.length > 2000) {
      setError('Enter a value between 1 and 2,000 characters.');
      return;
    }

    setIsSaving(true);
    setError(null);
    const startedAt = Date.now();

    // Optimistic — rolled back below on failure.
    const previous = value;
    onSaved(next);
    setIsEditing(false);

    try {
      const res = await fetch(`/api/key-terms/${termId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value: next }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error?.message ?? 'Could not save that change.');
      }

      await recordEvent(supabase, {
        userId,
        contractId,
        eventType: 'term_edited',
        durationMs: Date.now() - startedAt,
      });
    } catch (err) {
      onSaved(previous ?? '');
      setError(err instanceof Error ? err.message : 'Could not save that change.');
    } finally {
      setIsSaving(false);
    }
  }

  if (!isEditing) {
    return (
      <div className="flex flex-col gap-1">
        <button
          type="button"
          onClick={() => {
            setDraft(value ?? '');
            setIsEditing(true);
          }}
          className="text-left text-body text-grey-900 hover:underline"
        >
          {value ?? <span className="italic text-grey-300">Not found in document</span>}
        </button>
        {error && (
          <p role="alert" className="text-caption text-danger-700">
            {error}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <Input
        ref={inputRef}
        value={draft}
        disabled={isSaving}
        aria-label="Edit extracted value"
        onFocus={(e) => e.currentTarget.select()}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => void save()}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            void save();
          }
          if (e.key === 'Escape') {
            e.preventDefault();
            setDraft(value ?? '');
            setError(null);
            setIsEditing(false);
          }
        }}
      />
      {error && (
        <p role="alert" className="text-caption text-danger-700">
          {error}
        </p>
      )}
    </div>
  );
}
