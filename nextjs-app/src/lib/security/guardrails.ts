import 'server-only';
import { createHash } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { analyseQuery } from '@/lib/ai/query-classifier';
import { INJECTION_PATTERNS } from './patterns/injection';
import { OFF_SCOPE_PATTERNS } from './patterns/off-scope';
import { PII_PATTERNS } from './patterns/pii';
import { PROFANITY_LIST } from './patterns/profanity-list';
import { COMPARATIVE_WORDS, COMPETITORS, COMPETITOR_WINDOW_TOKENS, competitorPatternId } from './patterns/competitors';
import type { GuardrailPattern } from './patterns/types';

/**
 * Harmless policy (spec 13 v1.1 §A, PRD §9 rules 1–5). The rule table is code.
 * Three entry points: `screenInbound` (chat message), `screenDocument`
 * (contract text, process route) and `screenOutbound` (assistant answer).
 * Every match writes one `guardrail_events` row — rule, stage, action,
 * `input_hash = sha256(text)`, `matched = pattern id`, never the text — on the
 * caller's JWT, before the action is applied.
 *
 * Order: inbound injection → off-scope → profanity; outbound profanity →
 * competitor → PII. The first `block` wins; `flag` and `rewrite` accumulate.
 */

export type GuardrailStage = 'inbound' | 'document' | 'outbound';
export type GuardrailAction = 'allow' | 'flag' | 'block' | 'rewrite';
export type GuardrailRuleKey =
  | 'profanity_hate'
  | 'competitor_disparagement'
  | 'stay_within_contract'
  | 'prompt_injection'
  | 'escalate'
  | 'no_pii_solicitation';

export interface GuardrailContext {
  stage: GuardrailStage;
  /** From the classifier (inbound only): the message names the contract. */
  contractSignal?: boolean;
  /** From the classifier (inbound only): the message refers to the conversation. */
  historySignal?: boolean;
}

/** A rule firing. `matched` is a pattern id; no field ever holds the screened text. */
export interface GuardrailMatch {
  rule: GuardrailRuleKey;
  stage: GuardrailStage;
  action: Exclude<GuardrailAction, 'allow'>;
  matched: string;
}

export interface GuardrailRule {
  key: GuardrailRuleKey;
  prd_rule: 1 | 2 | 3 | 4 | 5;
  status: 'built' | 'stub';
  stages: GuardrailStage[];
  /** The rule's default action; `detect` may return a stage-specific one. */
  action: GuardrailAction;
  reply?: string;
  /** What the rule still allows — named next to what it blocks, per the PRD. */
  allowed: string;
  detect: (text: string, ctx: GuardrailContext) => { matched: string; action?: GuardrailAction; reply?: string } | null;
}

/** The rule-3 reply: off-scope questions and inbound injection. Also counts as "unresolved" (spec 20 §5.1). */
export const OFF_SCOPE_REPLY =
  'I can only answer about this contract. Try rephrasing your question to point at a clause, a term or a page.';
export const PROFANITY_BLOCK_REPLY = 'I can help with questions about this contract.';
export const PROFANITY_REWRITE =
  "I can't repeat that wording. Ask me about the contract and I'll answer from the document.";
export const COMPETITOR_REWRITE = "I don't compare tools or products — I can only tell you what this contract says.";
export const PII_REWRITE = "I don't need any personal details — everything I answer comes from the contract itself.";

function firstPattern(patterns: GuardrailPattern[], text: string): string | null {
  return patterns.find((p) => p.pattern.test(text))?.id ?? null;
}

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const PROFANITY = PROFANITY_LIST.map(({ id, word }) => ({
  id,
  pattern: new RegExp(`\\b${escapeRegExp(word).replace(/ /g, '\\s+')}\\b`, 'i'),
}));

function detectProfanity(text: string): string | null {
  return PROFANITY.find((p) => p.pattern.test(text))?.id ?? null;
}

/** A competitor name within 12 tokens of a comparative/disparaging word. */
function detectCompetitor(text: string): string | null {
  const tokens = text.toLowerCase().match(/[a-z0-9']+/g) ?? [];
  const comparatives = new Set<string>(COMPARATIVE_WORDS);
  const comparativeAt = tokens.flatMap((t, i) => (comparatives.has(t) ? [i] : []));
  if (comparativeAt.length === 0) return null;
  for (const name of COMPETITORS) {
    const lower = name.toLowerCase();
    for (let i = 0; i < tokens.length; i += 1) {
      if (tokens[i] !== lower) continue;
      if (comparativeAt.some((j) => Math.abs(i - j) <= COMPETITOR_WINDOW_TOKENS)) return competitorPatternId(name);
    }
  }
  return null;
}

/** Evaluation order is array order within each stage (spec 13 v1.1 §A). */
export const GUARDRAIL_RULES: GuardrailRule[] = [
  {
    key: 'prompt_injection',
    prd_rule: 3,
    status: 'built',
    stages: ['inbound', 'document'],
    action: 'block',
    reply: OFF_SCOPE_REPLY,
    allowed: 'Contract questions that use words like "override", "instructions" or "act as" about the contract itself.',
    detect: (text, ctx) => {
      const matched = firstPattern(INJECTION_PATTERNS, text);
      if (!matched) return null;
      // Document: flag only — it is the user's own contract, and processing
      // continues; extraction stays schema-validated and source-verified.
      return ctx.stage === 'document' ? { matched, action: 'flag' } : { matched, action: 'block', reply: OFF_SCOPE_REPLY };
    },
  },
  {
    key: 'stay_within_contract',
    prd_rule: 3,
    status: 'built',
    stages: ['inbound'],
    action: 'block',
    reply: OFF_SCOPE_REPLY,
    allowed: 'Grounded, document-only answers to any question about this contract.',
    detect: (text, ctx) => {
      if (ctx.contractSignal || ctx.historySignal) return null;
      const matched = firstPattern(OFF_SCOPE_PATTERNS, text);
      return matched ? { matched, action: 'block', reply: OFF_SCOPE_REPLY } : null;
    },
  },
  {
    key: 'profanity_hate',
    prd_rule: 1,
    status: 'stub',
    stages: ['inbound', 'outbound'],
    action: 'flag',
    allowed: 'A frustrated user with a real contract question still gets an answer.',
    detect: (text, ctx) => {
      const matched = detectProfanity(text);
      if (!matched) return null;
      if (ctx.stage === 'outbound') return { matched, action: 'rewrite', reply: PROFANITY_REWRITE };
      // Inbound: answer the contract question if there is one; abuse only ⇒ fixed reply, no model call.
      return ctx.contractSignal ? { matched, action: 'flag' } : { matched, action: 'block', reply: PROFANITY_BLOCK_REPLY };
    },
  },
  {
    key: 'competitor_disparagement',
    prd_rule: 2,
    status: 'stub',
    stages: ['outbound'],
    action: 'rewrite',
    reply: COMPETITOR_REWRITE,
    allowed: "Facts from the contract about the counterparty's own products.",
    detect: (text) => {
      const matched = detectCompetitor(text);
      return matched ? { matched, action: 'rewrite', reply: COMPETITOR_REWRITE } : null;
    },
  },
  {
    key: 'escalate',
    prd_rule: 4,
    status: 'stub',
    // Not a text screen: fired by the unresolved-turn counter (spec 20 §5.1)
    // through `recordEscalationFlag`, with matched 'turns.3'.
    stages: [],
    action: 'flag',
    allowed: 'The offer is a UI affordance (EscalateOffer), never model text.',
    detect: () => null,
  },
  {
    key: 'no_pii_solicitation',
    prd_rule: 5,
    status: 'stub',
    stages: ['outbound'],
    action: 'rewrite',
    reply: PII_REWRITE,
    allowed: 'Personal details already in the contract are shown as extracted.',
    detect: (text) => {
      const matched = firstPattern(PII_PATTERNS, text);
      return matched ? { matched, action: 'rewrite', reply: PII_REWRITE } : null;
    },
  },
];

/** Inbound runs injection → off-scope → profanity; outbound profanity → competitor → PII. */
const STAGE_ORDER: Record<GuardrailStage, GuardrailRuleKey[]> = {
  inbound: ['prompt_injection', 'stay_within_contract', 'profanity_hate'],
  document: ['prompt_injection'],
  outbound: ['profanity_hate', 'competitor_disparagement', 'no_pii_solicitation'],
};

export interface GuardrailVerdict {
  /** The strongest action taken: block > rewrite > flag > allow. */
  action: GuardrailAction;
  /** Block: the fixed reply. Rewrite: the replacement answer. Never the screened text. */
  replacement: string | null;
  matches: GuardrailMatch[];
}

/** Pure evaluation — no I/O. The entry points below add the event rows. */
export function evaluateGuardrails(text: string, ctx: GuardrailContext): GuardrailVerdict {
  const matches: GuardrailMatch[] = [];
  let replacement: string | null = null;
  let action: GuardrailAction = 'allow';

  for (const key of STAGE_ORDER[ctx.stage]) {
    const rule = GUARDRAIL_RULES.find((r) => r.key === key)!;
    const hit = rule.detect(text, ctx);
    if (!hit) continue;
    const hitAction = (hit.action ?? rule.action) as GuardrailMatch['action'];
    matches.push({ rule: rule.key, stage: ctx.stage, action: hitAction, matched: hit.matched });

    if (hitAction === 'block') {
      // First block wins: nothing after it runs.
      return { action: 'block', replacement: hit.reply ?? rule.reply ?? null, matches };
    }
    if (hitAction === 'rewrite') {
      // Cumulative: every rewrite is logged; the first one's text is what is stored.
      replacement ??= hit.reply ?? rule.reply ?? null;
      action = 'rewrite';
    } else if (action === 'allow') {
      action = 'flag';
    }
  }
  return { action, replacement, matches };
}

export function sha256Hex(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

interface ScreenOptions {
  supabase: SupabaseClient;
  userId: string;
  contractId: string;
}

/** One row per match, on the caller's JWT, hash only. A failed write is logged, never fatal. */
async function recordMatches(opts: ScreenOptions, text: string, matches: GuardrailMatch[]): Promise<void> {
  if (matches.length === 0) return;
  const inputHash = sha256Hex(text);
  const { error } = await opts.supabase.from('guardrail_events').insert(
    matches.map((m) => ({
      user_id: opts.userId,
      contract_id: opts.contractId,
      rule: m.rule,
      stage: m.stage,
      action: m.action,
      input_hash: inputHash,
      matched: m.matched,
    })),
  );
  if (error) console.error(JSON.stringify({ guardrail: 'event_write_failed', code: error.code ?? null }));
}

async function screen(text: string, ctx: GuardrailContext, opts: ScreenOptions): Promise<GuardrailVerdict> {
  const verdict = evaluateGuardrails(text, ctx);
  await recordMatches(opts, text, verdict.matches);
  return verdict;
}

/** Chat message, before anything else touches it. */
export function screenInbound(message: string, opts: ScreenOptions & { hasHistory: boolean }): Promise<GuardrailVerdict> {
  const { contractSignal, historySignal } = analyseQuery(message, opts.hasHistory);
  return screen(message, { stage: 'inbound', contractSignal, historySignal }, opts);
}

/** Contract text at process time: flag and log only; processing continues. */
export function screenDocument(contractText: string, opts: ScreenOptions): Promise<GuardrailVerdict> {
  return screen(contractText, { stage: 'document' }, opts);
}

/** Assistant answer, before it is stored. */
export function screenOutbound(answer: string, opts: ScreenOptions): Promise<GuardrailVerdict> {
  return screen(answer, { stage: 'outbound' }, opts);
}

/** Rule 4 (spec 20 §5.1): the escalation offer fired. `text` is the answer it fired on. */
export async function recordEscalationFlag(text: string, opts: ScreenOptions): Promise<void> {
  await recordMatches(opts, text, [{ rule: 'escalate', stage: 'outbound', action: 'flag', matched: 'turns.3' }]);
}
