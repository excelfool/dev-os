// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { KeyTermRow } from '@/components/terms/KeyTermRow';
import { TargetPageProvider } from '@/hooks/use-target-page';
import type { KeyTerm } from '@/types/domain';

/**
 * Spec 07 v1.1 §C/§G: the "Why?" disclosure carries a **Source** block and a
 * **Reasoning** block, and the per-field "Page edited" / "Reasoning edited"
 * tags appear only for the field they describe.
 */

vi.mock('@/lib/supabase/client', () => ({ createBrowserSupabaseClient: () => ({}) }));
vi.mock('@/lib/metrics/events', () => ({ recordEvent: vi.fn(async () => undefined) }));

const BASE: KeyTerm = {
  id: 't1',
  contract_id: 'c1',
  user_id: 'u1',
  term_name: 'Governing Law',
  value: 'State of Delaware',
  page_number: 4,
  confidence_score: 92,
  source_sentence: 'This Agreement is governed by the laws of the State of Delaware.',
  is_source_verified: true,
  is_custom: false,
  display_rank: 1,
  original_ai_value: 'State of Delaware',
  is_edited: false,
  edited_at: null,
  created_at: '2026-09-22T00:00:00.000Z',
  reasoning: 'Clause 9 names Delaware as the governing law.',
  original_ai_page: 4,
  original_ai_reasoning: 'Clause 9 names Delaware as the governing law.',
  page_edited: false,
  reasoning_edited: false,
};

function renderRow(overrides: Partial<KeyTerm> = {}) {
  return render(
    <TargetPageProvider>
      <ul>
        <KeyTermRow term={{ ...BASE, ...overrides }} userId="u1" contractId="c1" pageCount={20} />
      </ul>
    </TargetPageProvider>,
  );
}

/** Opens the "Why?" disclosure, which is where Source and Reasoning live. */
function openWhy() {
  fireEvent.click(screen.getByRole('button', { name: /why\?/i }));
}

beforeEach(() => {
  global.fetch = vi.fn(async () => new Response(JSON.stringify({}), { status: 200 })) as never;
});
afterEach(cleanup);

describe('WhySection (spec 07 v1.1 §C)', () => {
  it('renders a Source block with the sentence and its page', async () => {
    renderRow();
    openWhy();

    const source = screen.getByRole('group', { name: 'Source' });
    expect(within(source).getByText(/governed by the laws of the State of Delaware/)).toBeTruthy();
    expect(within(source).getByText('Found on page 4')).toBeTruthy();
  });

  it('renders a Reasoning block with the reasoning sentence', async () => {
    renderRow();
    openWhy();

    const reasoning = screen.getByRole('group', { name: 'Reasoning' });
    expect(within(reasoning).getByText(/Clause 9 names Delaware/)).toBeTruthy();
  });

  it('uses the null copy when the model returned no reasoning', async () => {
    renderRow({ reasoning: null });
    openWhy();

    const reasoning = screen.getByRole('group', { name: 'Reasoning' });
    expect(within(reasoning).getByText('No reasoning was returned for this term.')).toBeTruthy();
  });

  it('keeps the existing no-sentence copy in the Source block', async () => {
    renderRow({ source_sentence: null });
    openWhy();

    const source = screen.getByRole('group', { name: 'Source' });
    expect(within(source).getByText('No supporting sentence was found for this term.')).toBeTruthy();
  });

  it('keeps the unverified-source warning', async () => {
    renderRow({ is_source_verified: false });
    openWhy();

    expect(screen.getByText(/couldn't match this sentence to the document text/i)).toBeTruthy();
  });
});

describe('per-field edited tags (spec 07 v1.1 §D)', () => {
  it('shows no edit tags on an untouched term', async () => {
    renderRow();
    openWhy();

    expect(screen.queryByText('Page edited')).toBeNull();
    expect(screen.queryByText('Reasoning edited')).toBeNull();
    expect(screen.queryByText('Edited')).toBeNull();
  });

  it('shows "Page edited" for a page edit only', async () => {
    renderRow({ page_edited: true });
    openWhy();

    expect(screen.getByText('Page edited')).toBeTruthy();
    expect(screen.queryByText('Reasoning edited')).toBeNull();
    expect(screen.queryByText('Edited')).toBeNull();
  });

  it('shows "Reasoning edited" for a reasoning edit only', async () => {
    renderRow({ reasoning_edited: true });
    openWhy();

    expect(screen.getByText('Reasoning edited')).toBeTruthy();
    expect(screen.queryByText('Page edited')).toBeNull();
    expect(screen.queryByText('Edited')).toBeNull();
  });

  it('shows the value "Edited" badge independently of the other two', async () => {
    renderRow({ is_edited: true });
    openWhy();

    expect(screen.getByText('Edited')).toBeTruthy();
    expect(screen.queryByText('Page edited')).toBeNull();
    expect(screen.queryByText('Reasoning edited')).toBeNull();
  });
});

describe('edit affordances (spec 07 v1.1 §D)', () => {
  it('offers a pencil to edit the page number', () => {
    renderRow();

    fireEvent.click(screen.getByRole('button', { name: 'Edit page number' }));

    expect(screen.getByRole('spinbutton', { name: /page number/i })).toBeTruthy();
  });

  it('offers an Edit link on the Reasoning block', () => {
    renderRow();
    openWhy();

    const reasoning = screen.getByRole('group', { name: 'Reasoning' });
    fireEvent.click(within(reasoning).getByRole('button', { name: 'Edit' }));

    expect(screen.getByRole('textbox', { name: /edit reasoning/i })).toBeTruthy();
  });

  it('cancels a page edit on Escape without calling the API', () => {
    renderRow();

    fireEvent.click(screen.getByRole('button', { name: 'Edit page number' }));
    fireEvent.keyDown(screen.getByRole('spinbutton', { name: /page number/i }), { key: 'Escape' });

    expect(screen.queryByRole('spinbutton', { name: /page number/i })).toBeNull();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('saves a page edit with a PATCH carrying only page_number', async () => {
    renderRow();

    fireEvent.click(screen.getByRole('button', { name: 'Edit page number' }));
    const input = screen.getByRole('spinbutton', { name: /page number/i });
    fireEvent.change(input, { target: { value: '7' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));
    const call = (global.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(call[0]).toBe('/api/key-terms/t1');
    expect(JSON.parse((call[1] as RequestInit).body as string)).toEqual({ page_number: 7 });
  });
});
