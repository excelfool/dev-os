/** Query-enhancer prompt, verbatim from spec 08 v1.1 §B. */
export const QUERY_ENHANCER_SYSTEM_PROMPT =
  "Rewrite the user's question about a contract into one precise, self-contained retrieval query: expand pronouns using the conversation, name the clause type in contract vocabulary (e.g. 'auto-renewal', 'termination for convenience', 'limitation of liability'), keep every constraint the user stated, add nothing the user did not ask. Return `{ \"query\": \"…\" }`.";

/** The conversation is given only so pronouns can be expanded; recent turns suffice. */
export const ENHANCER_HISTORY_TURNS = 6;
const ENHANCER_TURN_CHARS = 500;

export function buildQueryEnhancerUserMessage(
  question: string,
  history: Array<{ role: 'user' | 'assistant'; content: string }>,
): string {
  const recent = history
    .slice(-ENHANCER_HISTORY_TURNS)
    .map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content.slice(0, ENHANCER_TURN_CHARS)}`);
  const conversation = recent.length > 0 ? `Conversation so far:\n${recent.join('\n')}\n\n` : '';
  return `${conversation}Question to rewrite: ${question}`;
}
