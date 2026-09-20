import 'server-only';
import { estimateTokens } from '@/lib/pdf/page-utils';
import { normalise } from '@/lib/utils/normalise-text';
import { buildChatSystemPrompt, buildDocumentContextBlock, CANNOT_FIND_ANSWER } from '@/lib/ai/prompts/chat.v1';
import type { LlmMessage } from '@/lib/ai/openai-client';
import type { QueryClass } from '@/types/domain';

/**
 * Context assembly and citation enforcement (spec 08 §§5–6).
 */

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
}): LlmMessage[] {
  const { queryClass, contractText, history, userMessage, maxHistoryTokens } = params;

  const messages: LlmMessage[] = [
    { role: 'system', content: buildChatSystemPrompt(queryClass) },
  ];

  // Class 'history' omits the document body, cutting tokens and latency for
  // questions about the conversation itself.
  if (queryClass !== 'history') {
    messages.push({ role: 'system', content: buildDocumentContextBlock(contractText) });
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

  const matches = [...content.matchAll(/\[Page\s+(\d+)\]/gi)];

  const citedPages = [
    ...new Set(
      matches
        .map((m) => Number(m[1]))
        // A citation naming a page outside the document is discarded and
        // counts as "no citation".
        .filter((page) => Number.isInteger(page) && page >= 1 && page <= pageCount),
    ),
  ].sort((a, b) => a - b);

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
