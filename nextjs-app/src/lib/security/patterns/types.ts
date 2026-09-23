/** One detectable pattern. `id` is what `guardrail_events.matched` stores — never the text. */
export interface GuardrailPattern {
  id: string;
  pattern: RegExp;
  /** A message the pattern must match — asserted by tests/unit/guardrails.test.ts. */
  example: string;
}
