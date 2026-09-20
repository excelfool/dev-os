import 'server-only';

/**
 * Prompt-injection screening (security-foundation skill §4, spec 13 §7).
 *
 * The posture already in place is architectural: the system prompt always
 * comes first, the contract body is passed as a separate block explicitly
 * labelled as data, and the model is told never to use general legal
 * knowledge. This module adds the missing input-side control — user messages
 * were previously sent to the model with no screening at all.
 *
 * DESIGN NOTE, and the reason the patterns are narrow. This product's whole
 * job is answering questions about legal documents, and legal prose is full of
 * the words a naive injection filter keys on: "override", "instructions",
 * "act as", "notwithstanding the previous". A filter that blocks
 * "Does this agreement override the previous version?" has broken the product
 * to no security benefit, because the model cannot act on an instruction
 * anyway — it has no tools, no write path, and the route never executes its
 * output. So each pattern requires an imperative aimed at the ASSISTANT, not
 * merely a suspicious word. False negatives here are cheap; false positives
 * are not.
 */

export type InjectionRule =
  | 'instruction-override'
  | 'system-prompt-exfiltration'
  | 'secret-exfiltration'
  | 'role-reassignment'
  | 'jailbreak';

export interface InjectionVerdict {
  blocked: boolean;
  rule: InjectionRule | null;
}

/**
 * Each pattern anchors on a verb addressed to the assistant. The
 * `(?:^|[.;!?]\s*|\s)` prefix means the imperative has to start a clause —
 * "Ignore the schedule" as a fragment of a longer contract question does not
 * match the override rule, because that rule additionally requires the object
 * to be the instructions themselves.
 */
const PATTERNS: Array<{ rule: InjectionRule; pattern: RegExp }> = [
  {
    rule: 'instruction-override',
    // The verb must be IMPERATIVE — starting the message or a clause, not
    // merely present in it. Without this anchor the rule fired on "Does clause
    // 7 override the previous agreement instructions?", which is an ordinary
    // contract question and precisely what the product exists to answer.
    pattern:
      /(?:^|[.;!?]\s*|\b(?:and|then|now|also)\s+)(?:please\s+)?(ignore|disregard|forget|override|bypass)\b[^.?!]{0,40}\b(previous|prior|above|earlier|initial|all|your|system)\b[^.?!]{0,20}\b(instruction|instructions|rule|rules|prompt|prompts|direction|directions|guideline|guidelines)\b/i,
  },
  {
    rule: 'system-prompt-exfiltration',
    pattern:
      /\b(reveal|show|print|repeat|output|display|disclose|tell me)\b[^.?!]{0,30}\b(your|the)\b[^.?!]{0,20}\b(system prompt|system message|initial prompt|instructions|prompt verbatim)\b/i,
  },
  {
    rule: 'secret-exfiltration',
    pattern:
      /\b(reveal|show|print|expose|leak|give me|tell me|what is|what are)\b[^.?!]{0,30}\b(api[ _-]?key|api[ _-]?keys|secret key|service[ _-]?role|env(?:ironment)? variables?|env vars?|credentials|password|access token|SUPABASE_[A-Z_]+|OPENAI_[A-Z_]+)\b/i,
  },
  {
    rule: 'role-reassignment',
    pattern:
      /(?:^|[.;!?]\s*)\s*(?:you are (?:now|from now on)\b|act as (?:an?|the)\b|pretend (?:you are|to be)\b|roleplay as\b|from now on,? you\b)/i,
  },
  {
    rule: 'jailbreak',
    pattern: /\b(jailbreak|jailbroken|DAN mode|developer mode|do anything now|unrestricted mode)\b/i,
  },
];

export function detectPromptInjection(message: string): InjectionVerdict {
  for (const { rule, pattern } of PATTERNS) {
    if (pattern.test(message)) return { blocked: true, rule };
  }
  return { blocked: false, rule: null };
}

/**
 * Neutralises text the USER DID NOT TYPE but which still reaches the model —
 * contract bodies and user-named custom terms.
 *
 * This is not the same control as `detectPromptInjection`. A contract is not a
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
