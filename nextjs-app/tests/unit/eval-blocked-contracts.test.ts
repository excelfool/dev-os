import { describe, expect, it } from 'vitest';
import { blockedContractRows, blockingGate } from '../../eval/lib/blocked-contracts';
import { repeatsPreviousAnswer } from '../../eval/lib/memory-checks';
import { MEMORY_CASES } from '../../eval/datasets/chat-memory';
import { classifyQuery } from '@/lib/ai/query-classifier';

/**
 * C25/C27 (spec 08 v1.1 §D note, 2026-09-23). Fixture: the five instructor
 * contracts the gates stop, measured with the app's own extractPdfText and
 * estimateTokens, plus two that pass.
 */
const LIMITS = { maxPages: 20, maxTokens: 15_000 };
const FIXTURE = [
  { contract: 'Stripe', pageCount: 35, tokens: 17_546 },
  { contract: 'Celonis', pageCount: 31, tokens: 20_213 },
  { contract: 'Square', pageCount: 141, tokens: 53_829 },
  { contract: 'Salesforce', pageCount: 16, tokens: 15_704 },
  { contract: 'Intuit', pageCount: 20, tokens: 17_259 },
  { contract: 'Expel', pageCount: 8, tokens: 8_879 },
  { contract: 'Adverity', pageCount: 13, tokens: 9_680 },
];

describe('blocked contracts (C25/C27)', () => {
  it('emits one SKIPPED row per blocked contract, naming the gate and retrieval.vector', () => {
    const rows = blockedContractRows(FIXTURE, LIMITS);
    expect(rows.map((r) => [r.contract, r.status, r.gate])).toEqual([
      ['Stripe', 'SKIPPED', 'MAX_PAGES'],
      ['Celonis', 'SKIPPED', 'MAX_PAGES'],
      ['Square', 'SKIPPED', 'MAX_PAGES'],
      ['Salesforce', 'SKIPPED', 'MAX_TOKENS'],
      ['Intuit', 'SKIPPED', 'MAX_TOKENS'],
    ]);
    for (const row of rows) expect(row.reason).toContain('retrieval.vector');
    expect(rows.find((r) => r.contract === 'Square')!.reason).toBe(
      'blocked by MAX_PAGES (141 pages > MAX_PAGES=20); needs retrieval.vector (chunked retrieval) to be scored',
    );
  });

  it('never PASS: every row is SKIPPED, and contracts inside the limits produce no row', () => {
    const rows = blockedContractRows(FIXTURE, LIMITS);
    expect(rows.every((r) => r.status === 'SKIPPED')).toBe(true);
    expect(rows.some((r) => r.contract === 'Expel' || r.contract === 'Adverity')).toBe(false);
  });

  it('checks pages before tokens, as the upload route does; 20 pages is within MAX_PAGES', () => {
    expect(blockingGate({ contract: 'x', pageCount: 35, tokens: 99_999 }, LIMITS)).toBe('MAX_PAGES');
    expect(blockingGate({ contract: 'x', pageCount: 20, tokens: 15_001 }, LIMITS)).toBe('MAX_TOKENS');
    expect(blockingGate({ contract: 'x', pageCount: 20, tokens: 15_000 }, LIMITS)).toBeNull();
  });
});


describe('the "summarize" memory case (Stage 5 chat item)', () => {
  it('is in the set, on the both path, and flagged mustNotRepeatPrevious', () => {
    const summarize = MEMORY_CASES.flatMap((c) => c.turns).find((t) => t.question === 'summarize');
    expect(summarize).toMatchObject({ expectedClass: 'both', expectRefusal: false, mustNotRepeatPrevious: true });
    // The classifier really does put it on the both path once a conversation exists.
    expect(classifyQuery('summarize', true)).toBe('both');
  });

  it('flags an answer that is the previous one again, ignoring case and whitespace', () => {
    const previous = 'Based on the document, invoices are due in 30 days. [Page 2]';
    expect(repeatsPreviousAnswer(`  ${previous.toUpperCase()} `, previous)).toBe(true);
    expect(repeatsPreviousAnswer('In short: payment is due within 30 days of invoice. [Page 2]', previous)).toBe(false);
    expect(repeatsPreviousAnswer(previous, undefined)).toBe(false);
  });
});
