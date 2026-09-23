import { normalise } from '@/lib/utils/normalise-text';

/**
 * True when `answer` is the previous assistant answer again, ignoring
 * whitespace and case — the "summarize returns the prior answer verbatim"
 * failure (chat-memory.ts `mustNotRepeatPrevious`).
 */
export function repeatsPreviousAnswer(answer: string, previous: string | undefined): boolean {
  return previous !== undefined && normalise(answer) === normalise(previous);
}
