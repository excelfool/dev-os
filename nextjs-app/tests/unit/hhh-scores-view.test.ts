import { describe, expect, it } from 'vitest';
import {
  HHH_SCORE_COLUMNS,
  scoredTermIds,
  subjectKey,
  toStoredScore,
  toStoredScores,
  type HhhScoreRow,
} from '@/lib/eval/hhh-scores-view';
import { APPLICABLE_CODES } from '@/lib/eval/hhh-codes';

/**
 * L14 (5d-3b). Review mode did not read back what it had saved: after a
 * refresh every questionnaire opened blank. Because route 32 writes ALL
 * applicable columns on each save, answering one question on a blank form
 * overwrote every stored answer with NULL — the reviewer's work disappeared
 * without an error. Hydration is what stops that, so the mapping from stored
 * row to form state is worth pinning down on its own.
 */

function row(overrides: Partial<HhhScoreRow> = {}): HhhScoreRow {
  return {
    id: 'score-1',
    subject_type: 'term',
    term_id: 't1',
    message_id: null,
    notes: null,
    helpful_verdict: 'pass',
    honest_verdict: 'pass',
    harmless_verdict: 'pass',
    ...overrides,
  } as HhhScoreRow;
}

describe('subjectKey (L14)', () => {
  it('keys a term by its id', () => {
    expect(subjectKey({ subject_type: 'term', term_id: 't1' })).toBe('term:t1');
  });

  it('keys a message by its id', () => {
    expect(subjectKey({ subject_type: 'message', message_id: 'm1' })).toBe('message:m1');
  });

  it('keys the summary by nothing else — there is one per contract', () => {
    expect(subjectKey({ subject_type: 'summary' })).toBe('summary');
  });

  it('keys a term and a message with the same id apart', () => {
    expect(subjectKey({ subject_type: 'term', term_id: 'x' })).not.toBe(
      subjectKey({ subject_type: 'message', message_id: 'x' }),
    );
  });
});

describe('HHH_SCORE_COLUMNS (L14)', () => {
  it('asks for every answer column, the verdicts and the notes', () => {
    for (const column of ['h1', 'h11', 'o9', 'a9']) {
      expect(HHH_SCORE_COLUMNS).toContain(column);
    }
    expect(HHH_SCORE_COLUMNS).toContain('helpful_verdict');
    expect(HHH_SCORE_COLUMNS).toContain('notes');
  });
});

describe('toStoredScore (L14)', () => {
  it('reads a stored Yes and No back as true and false', () => {
    const stored = toStoredScore(row({ h1: false, h4: true } as Partial<HhhScoreRow>));

    expect(stored.answers.H1).toBe(false);
    expect(stored.answers.H4).toBe(true);
  });

  it('keeps a stored NULL as null, so the form shows Skip', () => {
    const stored = toStoredScore(row({ h1: null } as Partial<HhhScoreRow>));

    expect(stored.answers.H1).toBeNull();
    // Present, not absent: a missing key would render nothing selected.
    expect('H1' in stored.answers).toBe(true);
  });

  it('carries every applicable code for a term', () => {
    const stored = toStoredScore(row());

    expect(Object.keys(stored.answers).sort()).toEqual([...APPLICABLE_CODES.term].sort());
  });

  it('carries only the subset for a message', () => {
    const stored = toStoredScore(row({ subject_type: 'message', term_id: null, message_id: 'm1' }));

    expect(Object.keys(stored.answers).sort()).toEqual([...APPLICABLE_CODES.message].sort());
    // A term-only code must not be sent back, or route 32 would reject it.
    expect('H11' in stored.answers).toBe(false);
  });

  it('carries only the subset for the summary', () => {
    const stored = toStoredScore(row({ subject_type: 'summary', term_id: null }));

    expect(Object.keys(stored.answers).sort()).toEqual([...APPLICABLE_CODES.summary].sort());
  });

  it('carries the notes and the three verdicts', () => {
    const stored = toStoredScore(
      row({ notes: 'Checked against clause 9.', helpful_verdict: 'fail' }),
    );

    expect(stored.notes).toBe('Checked against clause 9.');
    expect(stored.verdicts).toEqual({
      helpful_verdict: 'fail',
      honest_verdict: 'pass',
      harmless_verdict: 'pass',
    });
  });

  it('treats absent notes as an empty string, so the textarea stays controlled', () => {
    expect(toStoredScore(row({ notes: null })).notes).toBe('');
  });
});

describe('toStoredScores and scoredTermIds (L14)', () => {
  const ROWS = [
    row({ id: 's1', term_id: 't1' }),
    row({ id: 's2', term_id: 't2' }),
    row({ id: 's3', subject_type: 'summary', term_id: null }),
    row({ id: 's4', subject_type: 'message', term_id: null, message_id: 'm1' }),
  ];

  it('keys every row by its subject', () => {
    const map = toStoredScores(ROWS);

    expect([...map.keys()].sort()).toEqual(['message:m1', 'summary', 'term:t1', 'term:t2']);
  });

  it('counts distinct scored terms, ignoring the summary and messages', () => {
    expect(scoredTermIds(ROWS).size).toBe(2);
  });

  it('does not double-count a term — one row per term per reviewer', () => {
    // A re-save updates the row rather than adding one, so the id repeats.
    expect(scoredTermIds([...ROWS, row({ id: 's1', term_id: 't1' })]).size).toBe(2);
  });

  it('is empty for a contract nobody has scored', () => {
    expect(toStoredScores([]).size).toBe(0);
    expect(scoredTermIds([]).size).toBe(0);
  });
});
