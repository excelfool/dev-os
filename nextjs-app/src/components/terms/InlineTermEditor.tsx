'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Pencil } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { createBrowserSupabaseClient } from '@/lib/supabase/client';
import { recordEvent } from '@/lib/metrics/events';

/**
 * Inline editing of the three editable fields (US-009, spec 07 v1.1 §D).
 * Enter saves, Esc cancels, blur saves. Each field opens from its own control
 * and saves independently: one PATCH carrying one key, so a failed page edit
 * never rolls back a value the user already saved.
 *
 * Optimistic with rollback — the row shows the new text immediately and the
 * measured duration is the evidence for the ≤ 2 s target. A failure restores
 * the previous text and surfaces the server's own copy inline (`role="alert"`),
 * which is this app's established rollback notice; there is no toast layer.
 */

export type EditableField = 'value' | 'page' | 'reasoning';

/** The PATCH key and the accessible name each field is edited under. */
const FIELD = {
  value: { key: 'value', inputLabel: 'Edit extracted value' },
  page: { key: 'page_number', inputLabel: 'Page number' },
  reasoning: { key: 'reasoning', inputLabel: 'Edit reasoning' },
} as const;

const FALLBACK_ERROR = 'Could not save that change.';

export function InlineTermEditor({
  termId,
  userId,
  contractId,
  field = 'value',
  value,
  pageCount,
  onSaved,
}: {
  termId: string;
  userId: string;
  contractId: string;
  /** Which field this editor edits. Defaults to the value, the original case. */
  field?: EditableField;
  /** Current text; for `page`, the page number rendered as text (or null). */
  value: string | null;
  /** Required for `field="page"`: the client-side ceiling, matching the server's. */
  pageCount?: number;
  onSaved: (next: string) => void;
}) {
  const supabase = useMemo(() => createBrowserSupabaseClient(), []);
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? '');
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement>(null);

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

  /** Returns the copy for an invalid draft, or null when it is acceptable. */
  function validate(next: string): string | null {
    if (field === 'page') {
      const page = Number(next);
      if (!Number.isInteger(page) || page < 1 || (pageCount !== undefined && page > pageCount)) {
        return `Enter a page between 1 and ${pageCount ?? 1}.`;
      }
      return null;
    }
    if (field === 'reasoning') {
      return next.length >= 1 && next.length <= 500
        ? null
        : 'Enter reasoning between 1 and 500 characters.';
    }
    return next.length >= 1 && next.length <= 2000
      ? null
      : 'Enter a value between 1 and 2,000 characters.';
  }

  async function save() {
    const next = draft.trim();
    if (next === (value ?? '')) {
      setIsEditing(false);
      return;
    }

    const invalid = validate(next);
    if (invalid) {
      setError(invalid);
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
        body: JSON.stringify({ [FIELD[field].key]: field === 'page' ? Number(next) : next }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error?.message ?? FALLBACK_ERROR);
      }

      await recordEvent(supabase, {
        userId,
        contractId,
        eventType: 'term_edited',
        durationMs: Date.now() - startedAt,
        metadata: { field },
      });
    } catch (err) {
      onSaved(previous ?? '');
      setError(err instanceof Error ? err.message : FALLBACK_ERROR);
    } finally {
      setIsSaving(false);
    }
  }

  function open() {
    setDraft(value ?? '');
    setIsEditing(true);
  }

  function cancel() {
    setDraft(value ?? '');
    setError(null);
    setIsEditing(false);
  }

  const errorNote = error ? (
    <p role="alert" className="text-caption text-danger-700">
      {error}
    </p>
  ) : null;

  if (!isEditing) {
    if (field === 'page') {
      return (
        <span className="inline-flex items-center gap-1">
          <button
            type="button"
            onClick={open}
            aria-label="Edit page number"
            className="rounded-badge p-0.5 text-grey-400 hover:bg-grey-50 hover:text-grey-900"
          >
            <Pencil aria-hidden="true" className="h-3 w-3" />
          </button>
          {errorNote}
        </span>
      );
    }

    if (field === 'reasoning') {
      return (
        <span className="inline-flex flex-col gap-1">
          <button
            type="button"
            onClick={open}
            className="text-left text-caption text-grey-500 underline hover:text-grey-900"
          >
            Edit
          </button>
          {errorNote}
        </span>
      );
    }

    return (
      <div className="flex flex-col gap-1">
        <button
          type="button"
          onClick={open}
          className="text-left text-body text-grey-900 hover:underline"
        >
          {value ?? <span className="italic text-grey-500">Not found in document</span>}
        </button>
        {errorNote}
      </div>
    );
  }

  const keyHandlers = {
    onBlur: () => void save(),
    onKeyDown: (e: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      // In the textarea, Shift+Enter stays a newline — reasoning is prose.
      if (e.key === 'Enter' && !(field === 'reasoning' && e.shiftKey)) {
        e.preventDefault();
        void save();
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        cancel();
      }
    },
  };

  if (field === 'reasoning') {
    return (
      <div className="flex flex-col gap-1">
        <textarea
          ref={inputRef as React.RefObject<HTMLTextAreaElement>}
          value={draft}
          disabled={isSaving}
          rows={3}
          maxLength={500}
          aria-label={FIELD.reasoning.inputLabel}
          onChange={(e) => setDraft(e.target.value)}
          className="w-full rounded-input border border-grey-100 bg-white px-2 py-1 text-body text-grey-900 focus:border-grey-300 focus:outline-none"
          {...keyHandlers}
        />
        {errorNote}
      </div>
    );
  }

  if (field === 'page') {
    return (
      <span className="inline-flex flex-col gap-1">
        <Input
          ref={inputRef as React.RefObject<HTMLInputElement>}
          type="number"
          inputMode="numeric"
          min={1}
          max={pageCount}
          value={draft}
          disabled={isSaving}
          aria-label={FIELD.page.inputLabel}
          onFocus={(e) => e.currentTarget.select()}
          onChange={(e) => setDraft(e.target.value)}
          className="w-16"
          {...keyHandlers}
        />
        {errorNote}
      </span>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <Input
        ref={inputRef as React.RefObject<HTMLInputElement>}
        value={draft}
        disabled={isSaving}
        aria-label={FIELD.value.inputLabel}
        onFocus={(e) => e.currentTarget.select()}
        onChange={(e) => setDraft(e.target.value)}
        {...keyHandlers}
      />
      {errorNote}
    </div>
  );
}
