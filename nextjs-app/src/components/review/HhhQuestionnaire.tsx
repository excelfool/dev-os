'use client';

import { useEffect, useRef, useState } from 'react';
import { HHH_CODES, applicableCodes, type HhhSubjectType } from '@/lib/eval/hhh-codes';
import { useReviewMode } from '@/hooks/use-review-mode';

/**
 * The HHH questionnaire for one subject (spec 22 §2/§4, spec 07 v1.1 §E).
 *
 * Each applicable code is a `fieldset` whose `legend` is the question
 * **verbatim** from the instructor CSV, with the code as a small prefix —
 * paraphrasing a question would make two reviewers answer different things.
 * Yes / No / Skip are radios in one named group, so the browser gives arrow
 * keys within a group and Tab between groups for free (spec 22 §4 keyboard).
 *
 * Saves are debounced 800 ms after the last change and sent per subject. A
 * failure keeps the local answers and shows the app's inline `role="alert"`
 * notice, so a reviewer never loses a screen of work to one bad response.
 */

export const SAVE_DEBOUNCE_MS = 800;

export type Answer = boolean | null;

interface Verdicts {
  helpful_verdict: string;
  honest_verdict: string;
  harmless_verdict: string;
}

/** L13: the save response also carries the reviewer's own row count. */
interface SaveResponse extends Verdicts {
  human_row_count?: number;
}

const CHOICES: Array<{ label: string; value: Answer }> = [
  { label: 'Yes', value: true },
  { label: 'No', value: false },
  { label: 'Skip', value: null },
];

function choiceKey(value: Answer): string {
  return value === null ? 'skip' : String(value);
}

export function HhhQuestionnaire({
  contractId,
  subjectType,
  termId,
  messageId,
  stitched = false,
  label = 'Review',
}: {
  contractId: string;
  subjectType: HhhSubjectType;
  termId?: string;
  messageId?: string;
  /** Spec 22 §2: O8 is only asked of a stitched document. */
  stitched?: boolean;
  label?: string;
}) {
  const review = useReviewMode();
  const [open, setOpen] = useState(false);
  const [answers, setAnswers] = useState<Record<string, Answer>>({});
  const [notes, setNotes] = useState('');
  const [verdicts, setVerdicts] = useState<Verdicts | null>(null);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef(false);

  const codes = applicableCodes(subjectType, { stitched });
  const byCode = new Map(HHH_CODES.map((c) => [c.code, c]));
  // Unique per subject, so two questionnaires on one page never share a group.
  const groupPrefix = `hhh-${termId ?? messageId ?? contractId}-${subjectType}`;

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  async function save(nextAnswers: Record<string, Answer>, nextNotes: string) {
    pending.current = false;
    setError(null);
    try {
      const res = await fetch('/api/hhh-scores', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contract_id: contractId,
          subject_type: subjectType,
          ...(termId ? { term_id: termId } : {}),
          ...(messageId ? { message_id: messageId } : {}),
          answers: nextAnswers,
          ...(nextNotes.trim().length > 0 ? { notes: nextNotes.trim() } : {}),
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error?.message ?? 'Could not save that review.');
      }
      const body = (await res.json()) as SaveResponse;
      setVerdicts(body);
      // L13: the server's count is authoritative — an update does not add a
      // row, so incrementing locally would drift on every re-save.
      if (typeof body.human_row_count === 'number') review?.setHumanRowCount(body.human_row_count);
      if (termId) review?.markTermScored(termId);
    } catch (err) {
      // The answers stay on screen; only the save failed.
      setError(err instanceof Error ? err.message : 'Could not save that review.');
    }
  }

  /** One save 800 ms after the last change, however many changes land. */
  function scheduleSave(nextAnswers: Record<string, Answer>, nextNotes: string) {
    pending.current = true;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void save(nextAnswers, nextNotes), SAVE_DEBOUNCE_MS);
  }

  function answer(code: string, value: Answer) {
    const next = { ...answers, [code]: value };
    setAnswers(next);
    scheduleSave(next, notes);
  }

  return (
    <div className="mt-2 border-l-2 border-brand-100 pl-3">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="text-caption text-grey-500 underline hover:text-grey-900"
      >
        {label}
      </button>

      {open && (
        <div className="mt-2 flex flex-col gap-3">
          {codes.map((code) => {
            const definition = byCode.get(code);
            if (!definition) return null;
            const groupName = `${groupPrefix}-${code}`;
            return (
              <fieldset key={code} className="flex flex-col gap-1">
                <legend className="text-caption text-grey-700">
                  <span className="mr-1 text-grey-400">{code}</span>
                  {definition.question}
                </legend>
                <div className="flex items-center gap-3">
                  {CHOICES.map((choice) => (
                    <label key={choiceKey(choice.value)} className="flex items-center gap-1 text-caption text-grey-600">
                      <input
                        type="radio"
                        name={groupName}
                        value={choiceKey(choice.value)}
                        checked={(answers[code] ?? null) === choice.value && code in answers}
                        onChange={() => answer(code, choice.value)}
                      />
                      {choice.label}
                    </label>
                  ))}
                </div>
              </fieldset>
            );
          })}

          <label className="flex flex-col gap-1 text-caption text-grey-700">
            Notes
            <textarea
              rows={2}
              maxLength={1000}
              value={notes}
              onChange={(e) => {
                setNotes(e.target.value);
                scheduleSave(answers, e.target.value);
              }}
              className="w-full rounded-input border border-grey-100 bg-white px-2 py-1 text-body text-grey-900 focus:border-grey-300 focus:outline-none"
            />
          </label>

          {verdicts && (
            <div className="flex items-center gap-2" aria-label="Pillar verdicts">
              <VerdictPill pillar="Helpful" verdict={verdicts.helpful_verdict} />
              <VerdictPill pillar="Honest" verdict={verdicts.honest_verdict} />
              <VerdictPill pillar="Harmless" verdict={verdicts.harmless_verdict} />
            </div>
          )}

          {error && (
            <p role="alert" className="text-caption text-danger-700">
              {error}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function VerdictPill({ pillar, verdict }: { pillar: string; verdict: string }) {
  const pass = verdict === 'pass';
  return (
    <span
      className={`rounded-badge px-2 py-0.5 text-caption ${
        pass ? 'bg-success-50 text-success-700' : 'bg-danger-50 text-danger-700'
      }`}
    >
      {pillar} {pass ? 'pass' : 'fail'}
    </span>
  );
}
