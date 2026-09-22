// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { HhhQuestionnaire, SAVE_DEBOUNCE_MS } from '@/components/review/HhhQuestionnaire';
import { ReviewFooter } from '@/components/review/ReviewFooter';
import { ReviewModeToggle } from '@/components/review/ReviewModeToggle';
import { ReviewModeProvider } from '@/hooks/use-review-mode';
import { APPLICABLE_CODES, HHH_CODES } from '@/lib/eval/hhh-codes';

/**
 * Review mode (spec 22 §2/§4, spec 07 v1.1 §E, D53).
 */

const capabilityStatus = { current: 'stub' as 'built' | 'stub' | 'planned' };
vi.mock('@/lib/capabilities', () => ({
  getCapability: () => ({ status: capabilityStatus.current, key: 'eval.hhh_human' }),
  isBuilt: () => true,
}));

const VERDICTS = { id: 'score-1', helpful_verdict: 'pass', honest_verdict: 'fail', harmless_verdict: 'pass' };

const CONTRACT_ID = '11111111-1111-4111-8111-111111111111';
const TERM_ID = '22222222-2222-4222-8222-222222222222';

function renderQuestionnaire(props: Partial<React.ComponentProps<typeof HhhQuestionnaire>> = {}) {
  return render(
    <ReviewModeProvider initialOn>
      <HhhQuestionnaire contractId={CONTRACT_ID} subjectType="term" termId={TERM_ID} {...props} />
    </ReviewModeProvider>,
  );
}

/** Opens the disclosure that holds the questions. */
function openForm(label = 'Review') {
  fireEvent.click(screen.getByRole('button', { name: label }));
}

function lastBody(): Record<string, unknown> {
  const calls = (global.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls;
  return JSON.parse((calls.at(-1)![1] as RequestInit).body as string);
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  capabilityStatus.current = 'stub';
  global.fetch = vi.fn(async () => new Response(JSON.stringify(VERDICTS), { status: 200 })) as never;
});
afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

describe('ReviewModeToggle visibility (D53, spec 21 §1.4)', () => {
  it('is hidden while the capability is planned', () => {
    capabilityStatus.current = 'planned';

    render(
      <ReviewModeProvider>
        <ReviewModeToggle />
      </ReviewModeProvider>,
    );

    expect(screen.queryByRole('switch', { name: 'Review' })).toBeNull();
  });

  it('is visible with its note while the capability is a stub', () => {
    render(
      <ReviewModeProvider>
        <ReviewModeToggle />
      </ReviewModeProvider>,
    );

    expect(screen.getByRole('switch', { name: 'Review' })).toBeTruthy();
    expect(screen.getByText(/evaluation-sheet export arrives in Stage 7/)).toBeTruthy();
  });

  it('starts off, and flips on when clicked', () => {
    render(
      <ReviewModeProvider>
        <ReviewModeToggle />
      </ReviewModeProvider>,
    );

    const toggle = screen.getByRole('switch', { name: 'Review' });
    expect(toggle.getAttribute('aria-checked')).toBe('false');

    fireEvent.click(toggle);

    expect(screen.getByRole('switch', { name: 'Review' }).getAttribute('aria-checked')).toBe('true');
  });

  it('starts ON when the page was opened with ?mode=review', () => {
    render(
      <ReviewModeProvider initialOn>
        <ReviewModeToggle />
      </ReviewModeProvider>,
    );

    expect(screen.getByRole('switch', { name: 'Review' }).getAttribute('aria-checked')).toBe('true');
  });
});

describe('the questionnaire asks exactly the applicable codes (spec 22 §2)', () => {
  it('asks a term 28 codes, omitting O8 on an ordinary contract', () => {
    renderQuestionnaire({ label: 'Review' });
    openForm();

    expect(screen.getAllByRole('group')).toHaveLength(28);
    expect(screen.queryByText(/correct contract of a stitched document/)).toBeNull();
  });

  it('asks a term all 29 when the contract is stitched', () => {
    renderQuestionnaire({ stitched: true });
    openForm();

    expect(screen.getAllByRole('group')).toHaveLength(29);
    expect(screen.getByText(/correct contract of a stitched document/)).toBeTruthy();
  });

  it('asks a chat answer only its subset', () => {
    renderQuestionnaire({ subjectType: 'message', termId: undefined, messageId: '33333333-3333-4333-8333-333333333333' });
    openForm();

    expect(screen.getAllByRole('group')).toHaveLength(APPLICABLE_CODES.message.length);
  });

  it('asks a summary only its subset', () => {
    renderQuestionnaire({ subjectType: 'summary', termId: undefined });
    openForm();

    expect(screen.getAllByRole('group')).toHaveLength(APPLICABLE_CODES.summary.length);
  });

  it('shows each question verbatim, with its code as a prefix', () => {
    renderQuestionnaire();
    openForm();

    const h1 = HHH_CODES.find((c) => c.code === 'H1')!;
    const group = screen.getAllByRole('group')[0]!;
    expect(group.textContent).toContain('H1');
    expect(group.textContent).toContain(h1.question);
  });

  it('offers Yes, No and Skip in one radio group per code', () => {
    renderQuestionnaire();
    openForm();

    const group = screen.getAllByRole('group')[0]!;
    const radios = within(group).getAllByRole('radio');
    expect(radios).toHaveLength(3);
    // One name per code, so arrow keys stay inside the group.
    expect(new Set(radios.map((r) => r.getAttribute('name'))).size).toBe(1);
  });
});

describe('saving (spec 22 §4)', () => {
  it('sends null for Skip', async () => {
    renderQuestionnaire();
    openForm();

    const group = screen.getAllByRole('group')[0]!;
    fireEvent.click(within(group).getByRole('radio', { name: 'Skip' }));
    await act(async () => {
      vi.advanceTimersByTime(SAVE_DEBOUNCE_MS);
    });

    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));
    expect((lastBody().answers as Record<string, unknown>).H1).toBeNull();
  });

  it('sends the subject id and type', async () => {
    renderQuestionnaire();
    openForm();

    fireEvent.click(within(screen.getAllByRole('group')[0]!).getByRole('radio', { name: 'Yes' }));
    await act(async () => {
      vi.advanceTimersByTime(SAVE_DEBOUNCE_MS);
    });

    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));
    expect(lastBody()).toMatchObject({ contract_id: CONTRACT_ID, subject_type: 'term', term_id: TERM_ID });
  });

  it('coalesces several quick answers into ONE save', async () => {
    renderQuestionnaire();
    openForm();

    const groups = screen.getAllByRole('group');
    fireEvent.click(within(groups[0]!).getByRole('radio', { name: 'Yes' }));
    fireEvent.click(within(groups[1]!).getByRole('radio', { name: 'No' }));
    fireEvent.click(within(groups[2]!).getByRole('radio', { name: 'Skip' }));

    await act(async () => {
      vi.advanceTimersByTime(SAVE_DEBOUNCE_MS);
    });

    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));
    const answers = lastBody().answers as Record<string, unknown>;
    expect(Object.keys(answers)).toHaveLength(3);
  });

  it('does not save before the debounce elapses', async () => {
    renderQuestionnaire();
    openForm();

    fireEvent.click(within(screen.getAllByRole('group')[0]!).getByRole('radio', { name: 'Yes' }));
    await act(async () => {
      vi.advanceTimersByTime(SAVE_DEBOUNCE_MS - 1);
    });

    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('renders the three pillar verdicts the server returned', async () => {
    renderQuestionnaire();
    openForm();

    fireEvent.click(within(screen.getAllByRole('group')[0]!).getByRole('radio', { name: 'Yes' }));
    await act(async () => {
      vi.advanceTimersByTime(SAVE_DEBOUNCE_MS);
    });

    await waitFor(() => expect(screen.getByText('Helpful pass')).toBeTruthy());
    expect(screen.getByText('Honest fail')).toBeTruthy();
    expect(screen.getByText('Harmless pass')).toBeTruthy();
  });

  it('keeps the answers and shows an alert when the save fails', async () => {
    global.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ error: { code: 'INTERNAL', message: 'Something went wrong on our side.' } }), {
        status: 500,
      }),
    ) as never;
    renderQuestionnaire();
    openForm();

    const yes = within(screen.getAllByRole('group')[0]!).getByRole('radio', { name: 'Yes' });
    fireEvent.click(yes);
    await act(async () => {
      vi.advanceTimersByTime(SAVE_DEBOUNCE_MS);
    });

    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    // The answer the reviewer gave is still selected.
    expect((yes as HTMLInputElement).checked).toBe(true);
  });
});

/**
 * L13 (5d-3a). Live on contract 93ba9b49, one saved term score left the
 * footer reading "Scored 1 of 36 terms · 0 human rows total" while
 * `hhh_scores` held exactly one row for that owner. The count was never
 * fetched and never refreshed — the provider defaulted it to 0 and nothing
 * ever set it. Every successful save now carries the true count back.
 */
describe('ReviewFooter count (L13)', () => {
  function renderFooter(count: number, termCount = 36) {
    return render(
      <ReviewModeProvider initialOn initialHumanRowCount={count}>
        <ReviewFooter termCount={termCount} />
      </ReviewModeProvider>,
    );
  }

  it('shows the count it was given, not zero', () => {
    renderFooter(1);

    expect(screen.getByText(/1 human row\b/)).toBeTruthy();
  });

  it('says "1 human row", singular', () => {
    renderFooter(1);

    expect(screen.getByText(/· 1 human row total/)).toBeTruthy();
  });

  it('says "2 human rows", plural', () => {
    renderFooter(2);

    expect(screen.getByText(/· 2 human rows total/)).toBeTruthy();
  });

  it('says "0 human rows" before anything is scored', () => {
    renderFooter(0);

    expect(screen.getByText(/· 0 human rows total/)).toBeTruthy();
  });

  it('still reports the per-contract term progress', () => {
    renderFooter(3, 36);

    expect(screen.getByText(/Scored 0 of 36 terms on this contract/)).toBeTruthy();
  });
});

describe('the footer updates after a save (L13)', () => {
  it('takes the count from the save response, correcting the first one', async () => {
    global.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ ...VERDICTS, human_row_count: 1 }), { status: 200 }),
    ) as never;

    render(
      <ReviewModeProvider initialOn initialHumanRowCount={0}>
        <HhhQuestionnaire contractId={CONTRACT_ID} subjectType="term" termId={TERM_ID} />
        <ReviewFooter termCount={36} />
      </ReviewModeProvider>,
    );
    expect(screen.getByText(/· 0 human rows total/)).toBeTruthy();

    openForm();
    fireEvent.click(within(screen.getAllByRole('group')[0]!).getByRole('radio', { name: 'Yes' }));
    await act(async () => {
      vi.advanceTimersByTime(SAVE_DEBOUNCE_MS);
    });

    await waitFor(() => expect(screen.getByText(/· 1 human row total/)).toBeTruthy());
  });

  it('counts the scored term towards the per-contract progress', async () => {
    global.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ ...VERDICTS, human_row_count: 1 }), { status: 200 }),
    ) as never;

    render(
      <ReviewModeProvider initialOn>
        <HhhQuestionnaire contractId={CONTRACT_ID} subjectType="term" termId={TERM_ID} />
        <ReviewFooter termCount={36} />
      </ReviewModeProvider>,
    );

    openForm();
    fireEvent.click(within(screen.getAllByRole('group')[0]!).getByRole('radio', { name: 'Yes' }));
    await act(async () => {
      vi.advanceTimersByTime(SAVE_DEBOUNCE_MS);
    });

    await waitFor(() => expect(screen.getByText(/Scored 1 of 36 terms/)).toBeTruthy());
  });

  it('leaves the count alone when the save fails', async () => {
    global.fetch = vi.fn(async () => new Response('{}', { status: 500 })) as never;

    render(
      <ReviewModeProvider initialOn initialHumanRowCount={4}>
        <HhhQuestionnaire contractId={CONTRACT_ID} subjectType="term" termId={TERM_ID} />
        <ReviewFooter termCount={36} />
      </ReviewModeProvider>,
    );

    openForm();
    fireEvent.click(within(screen.getAllByRole('group')[0]!).getByRole('radio', { name: 'Yes' }));
    await act(async () => {
      vi.advanceTimersByTime(SAVE_DEBOUNCE_MS);
    });

    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(screen.getByText(/· 4 human rows total/)).toBeTruthy();
  });
});
