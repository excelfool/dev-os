import 'server-only';

/**
 * Untrusted text that reaches the model without being a user request:
 * contract bodies and user-named custom terms (security-foundation §4).
 *
 * Detection of injected INSTRUCTIONS lives in one place since Stage 6: the
 * `prompt_injection` rule of `src/lib/security/guardrails.ts`, whose
 * `inj.*` patterns (`patterns/injection.ts`) are the Lab 3 patterns that used
 * to live here as `detectPromptInjection`. This file keeps only the defanging
 * helpers, which are a different control.
 */

/**
 * Neutralises text the USER DID NOT TYPE but which still reaches the model —
 * contract bodies and user-named custom terms.
 *
 * This is not the same control as the `prompt_injection` guardrail. A contract is not a
 * request, so refusing to process one because its text resembles an
 * instruction would be wrong: the document is the product's input, and a
 * hostile clause inside it is exactly what a reviewer needs surfaced. The
 * treatment is therefore to defang rather than to reject.
 *
 * The concrete risk is marker forgery. `[PAGE N]` is a load-bearing token —
 * the extraction prompt, the chat prompt and `page-utils` all trust it to
 * attribute a citation to a page. A PDF whose body contains a literal
 * "[PAGE 99]" line can therefore move a citation to a page the text is not on,
 * which is a correctness and honesty failure in a product whose core claim is
 * that every answer is traceable to a page.
 */
export function sanitiseForLlm(text: string): string {
  // Only a marker occupying a whole line is authoritative (page-utils.ts uses
  // /^\[PAGE (\d+)\]$/gm), so breaking the line anchor is enough.
  return text.replace(/^\[PAGE (\d+)\]$/gm, '[page $1]');
}

/**
 * Custom term names are user input that lands inside the extraction SYSTEM
 * prompt, which is the highest-trust position in the request. They are capped
 * at 60 characters, but length is not the control — position is.
 */
export function sanitiseCustomTermName(name: string): string {
  return name
    .replace(/[\r\n]+/g, ' ')
    .replace(/^\s*[-*#>]+\s*/, '')
    .replace(/\s+/g, ' ')
    .trim();
}
