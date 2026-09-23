import { describe, expect, it } from 'vitest';
import { countUnresolvedTurns, isUnresolvedAnswer, type TurnRecord } from '@/lib/services/chat-service';
import { CANNOT_FIND_ANSWER } from '@/lib/ai/prompts/chat.v1';
import { OFF_SCOPE_REPLY } from '@/lib/security/guardrails';

/** Spec 20 §5.1 and §8 — the "~3 unresolved turns" counter. */

const q = (content = 'Is there an auto-renewal clause?'): TurnRecord => ({ role: 'user', content, citation_verified: true });
const fallback: TurnRecord = { role: 'assistant', content: CANNOT_FIND_ANSWER, citation_verified: true };
const answer: TurnRecord = { role: 'assistant', content: 'Based on the document, yes. [Page 2]', citation_verified: true };
const unverified: TurnRecord = { role: 'assistant', content: 'Based on the document, probably yes.', citation_verified: false };
const offScope: TurnRecord = { role: 'assistant', content: OFF_SCOPE_REPLY, citation_verified: true };

describe('countUnresolvedTurns', () => {
  it('three consecutive fallbacks ⇒ 3', () => {
    expect(countUnresolvedTurns([q(), fallback, q(), fallback, q(), fallback])).toBe(3);
  });

  it('fallback, answer, fallback ⇒ 1 (a resolved answer resets it)', () => {
    expect(countUnresolvedTurns([q(), fallback, q(), answer, q(), fallback])).toBe(1);
  });

  it('citation_verified = false counts as unresolved', () => {
    expect(countUnresolvedTurns([q(), unverified, q(), unverified, q(), unverified])).toBe(3);
  });

  it('the rule-3 off-scope reply counts as unresolved, mixed with the others', () => {
    expect(countUnresolvedTurns([q(), offScope, q(), unverified, q(), fallback])).toBe(3);
  });

  it('ends at the latest turn: a resolved latest answer is 0', () => {
    expect(countUnresolvedTurns([q(), fallback, q(), fallback, q(), answer])).toBe(0);
  });

  it('only the last 6 messages count, so it never exceeds 3 in a normal session', () => {
    const session = Array.from({ length: 5 }, () => [q(), fallback]).flat();
    expect(countUnresolvedTurns(session)).toBe(3);
  });

  it('an empty or question-only session is 0', () => {
    expect(countUnresolvedTurns([])).toBe(0);
    expect(countUnresolvedTurns([q()])).toBe(0);
  });
});

describe('isUnresolvedAnswer', () => {
  it('a user message is never an unresolved answer', () => {
    expect(isUnresolvedAnswer({ role: 'user', content: CANNOT_FIND_ANSWER, citation_verified: false })).toBe(false);
  });

  it('a verified, cited answer is resolved', () => {
    expect(isUnresolvedAnswer(answer)).toBe(false);
  });
});
