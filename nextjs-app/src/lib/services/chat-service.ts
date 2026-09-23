import 'server-only';
import { estimateTokens } from '@/lib/pdf/page-utils';
import { normalise } from '@/lib/utils/normalise-text';
import { citedPagesIn } from '@/lib/ai/citations';
import { OFF_SCOPE_REPLY } from '@/lib/security/guardrails';
import {
  buildChatSystemPrompt,
  buildDocumentContextBlock,
  buildSearchFocusBlock,
  CANNOT_FIND_ANSWER,
} from '@/lib/ai/prompts/chat.v1';
import type { LlmMessage } from '@/lib/ai/openai-client';
import type { QueryClass } from '@/types/domain';

/**
 * Context assembly and citation enforcement (spec 08 §§5–6).
 */

/**
 * G43: the whole turn — enhancer, answer with its retries, citation repair —
 * runs inside one budget measured from request start. Spec 08's chat budget
 * (≤ 15 s P95); never above route 34's 22 s (Netlify's sync ceiling is 26 s,
 * D36). callLlm starts no attempt that cannot finish before it, so a turn that
 * runs out returns 504 AI_TIMEOUT with the user's question already stored.
 */
export const CHAT_TURN_BUDGET_MS = 15_000;

export interface HistoryMessage {
  role: 'user' | 'assistant';
  content: string;
}

export function assembleChatMessages(params: {
  queryClass: QueryClass;
  contractText: string;
  history: HistoryMessage[];
  userMessage: string;
  maxHistoryTokens: number;
  /** Spec 08 v1.1 §B: the query enhancer's rewrite, or null when it did not run or failed. */
  enhancedQuery?: string | null;
}): LlmMessage[] {
  const { queryClass, contractText, history, userMessage, maxHistoryTokens, enhancedQuery } = params;

  const messages: LlmMessage[] = [
    { role: 'system', content: buildChatSystemPrompt(queryClass) },
  ];

  // Class 'history' omits the document body, cutting tokens and latency for
  // questions about the conversation itself.
  if (queryClass !== 'history') {
    messages.push({ role: 'system', content: buildDocumentContextBlock(contractText) });
    // §B: the rewrite follows the document block. The user's own words stay
    // the last user turn, so the answer still addresses what they asked.
    if (enhancedQuery) messages.push({ role: 'system', content: buildSearchFocusBlock(enhancedQuery) });
  }

  messages.push(...truncateHistory(history, maxHistoryTokens));
  messages.push({ role: 'user', content: userMessage });

  return messages;
}

/** Drops oldest-first until the history fits the token budget. */
export function truncateHistory(
  history: HistoryMessage[],
  maxHistoryTokens: number,
): HistoryMessage[] {
  let total = history.reduce((sum, m) => sum + estimateTokens(m.content), 0);
  if (total <= maxHistoryTokens) return history;

  const kept = [...history];
  while (kept.length > 0 && total > maxHistoryTokens) {
    const dropped = kept.shift();
    if (dropped) total -= estimateTokens(dropped.content);
  }
  return kept;
}

export interface CitationResult {
  citedPages: number[];
  citationVerified: boolean;
  /** True when the answer makes a claim but carries no valid citation. */
  needsRepair: boolean;
}

/**
 * `queryClass` added 2026-09-20. An answer about the conversation has no page
 * to cite, so the class-blind check flagged every correct history answer for
 * repair — a second billed call whose only possible "fix" is a page number the
 * model cannot have, and which would overwrite a correct answer with a
 * fabricated citation if it ever produced one.
 */
export function validateCitations(
  content: string,
  pageCount: number,
  queryClass: QueryClass = 'contract',
): CitationResult {
  if (queryClass === 'history') {
    return { citedPages: [], citationVerified: true, needsRepair: false };
  }

  // G44: the shared parser, so `[Page 1, 5, 7]`, `[Pages 3–4]` and
  // `[Page 3, Page 5]` count as citations here exactly as in the summary. A
  // page outside the document is discarded and counts as "no citation".
  const citedPages = citedPagesIn(content)
    .filter((page) => Number.isInteger(page) && page >= 1 && page <= pageCount)
    .sort((a, b) => a - b);

  // The exact fallback is a correct, expected answer — not a failure.
  if (isCannotFindAnswer(content)) {
    return { citedPages: [], citationVerified: true, needsRepair: false };
  }

  if (citedPages.length > 0) {
    return { citedPages, citationVerified: true, needsRepair: false };
  }

  return { citedPages: [], citationVerified: false, needsRepair: true };
}

export function isCannotFindAnswer(content: string): boolean {
  return normalise(content) === normalise(CANNOT_FIND_ANSWER);
}

/**
 * Spec 20 §5.1 — "~3 unresolved turns" (PRD Flow 4 step 7, harmless rule 4).
 * An assistant turn is unresolved when it is the exact "cannot find" fallback,
 * or `citation_verified = false`, or the rule-3 off-scope reply.
 */
export const UNRESOLVED_WINDOW_MESSAGES = 6;
export const ESCALATION_OFFER_THRESHOLD = 3;

export interface TurnRecord {
  role: 'user' | 'assistant';
  content: string;
  citation_verified: boolean | null;
}

export function isUnresolvedAnswer(message: TurnRecord): boolean {
  if (message.role !== 'assistant') return false;
  return isCannotFindAnswer(message.content) || message.citation_verified === false || message.content === OFF_SCOPE_REPLY;
}

/**
 * Consecutive unresolved assistant turns ending at the latest one, counted
 * within the session's last 6 messages (ascending order in); any resolved
 * answer resets it to 0.
 */
export function countUnresolvedTurns(messagesAscending: TurnRecord[]): number {
  let count = 0;
  for (const message of messagesAscending.slice(-UNRESOLVED_WINDOW_MESSAGES).reverse()) {
    if (message.role !== 'assistant') continue;
    if (!isUnresolvedAnswer(message)) break;
    count += 1;
  }
  return count;
}
