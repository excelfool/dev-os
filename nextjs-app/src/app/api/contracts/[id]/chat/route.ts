import { createServerSupabaseClient } from '@/lib/supabase/server';
import { appError } from '@/lib/errors/app-error';
import { withErrorHandling } from '@/lib/errors/to-user-message';
import { enforceRateLimit } from '@/lib/security/rate-limit';
import { chatMessageSchema } from '@/lib/validation/chat.schema';
import { callLlm } from '@/lib/ai/openai-client';
import { analyseQuery, GREETING_REPLY, isGreeting, shouldEnhanceQuery } from '@/lib/ai/query-classifier';
import { enhanceQuery } from '@/lib/ai/query-enhancer';
import { getRetrievalStrategy } from '@/lib/ai/retrieval';
import { OFF_SCOPE_REPLY, recordEscalationFlag, screenInbound, screenOutbound } from '@/lib/security/guardrails';
import { CITATION_REPAIR_PROMPT } from '@/lib/ai/prompts/repair.v1';
import {
  assembleFromBlocks,
  CHAT_TURN_BUDGET_MS,
  countUnresolvedTurns,
  ESCALATION_OFFER_THRESHOLD,
  UNRESOLVED_WINDOW_MESSAGES,
  validateCitations,
  validateDelegatedAnswer,
  type HistoryMessage,
  type TurnRecord,
} from '@/lib/services/chat-service';
import type { QueryClass } from '@/types/domain';
import { getServerConfig } from '@/lib/utils/server-config';
import { recordEvent } from '@/lib/metrics/events';
import { recordProcessingRun } from '@/lib/metrics/timings';
import { AppError } from '@/lib/errors/app-error';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Ensures the one-per-contract session exists, inserting it lazily. */
async function ensureSession(
  supabase: ReturnType<typeof createServerSupabaseClient>,
  contractId: string,
  userId: string,
): Promise<string> {
  const { data: existing } = await supabase
    .from('chat_sessions')
    .select('id')
    .eq('contract_id', contractId)
    .maybeSingle();

  if (existing) return existing.id;

  const { data: created, error } = await supabase
    .from('chat_sessions')
    .insert({ contract_id: contractId, user_id: userId })
    .select('id')
    .single();

  // A concurrent insert loses the UNIQUE(contract_id) race; re-read rather than
  // fail, so the session stays deterministic (US-012).
  if (error || !created) {
    const { data: raced } = await supabase
      .from('chat_sessions')
      .select('id')
      .eq('contract_id', contractId)
      .single();
    if (!raced) throw appError('INTERNAL');
    return raced.id;
  }

  return created.id;
}

/** GET /api/contracts/{id}/chat (spec 08 §2). */
export async function GET(_request: Request, { params }: { params: { id: string } }) {
  return withErrorHandling({ route: '/api/contracts/[id]/chat', method: 'GET' }, async (ctx) => {
    const cfg = getServerConfig();
    const supabase = createServerSupabaseClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) throw appError('UNAUTHENTICATED');
    ctx.userId = user.id;

    const { data: contract } = await supabase
      .from('contracts')
      .select('id')
      .eq('id', params.id)
      .eq('user_id', user.id)
      .single();
    if (!contract) throw appError('NOT_FOUND');

    const sessionId = await ensureSession(supabase, contract.id, user.id);

    const { data: messages } = await supabase
      .from('chat_messages')
      .select('id, role, content, cited_pages, citation_verified, created_at')
      .eq('session_id', sessionId)
      .order('created_at', { ascending: true })
      .limit(cfg.MAX_CHAT_HISTORY_MESSAGES);

    return Response.json({ session_id: sessionId, messages: messages ?? [] });
  });
}

/** POST /api/contracts/{id}/chat (spec 08 §3). */
export async function POST(request: Request, { params }: { params: { id: string } }) {
  const requestStartedAt = Date.now();
  const deadlineAt = requestStartedAt + CHAT_TURN_BUDGET_MS;

  return withErrorHandling({ route: '/api/contracts/[id]/chat', method: 'POST' }, async (ctx) => {
    const cfg = getServerConfig();
    const supabase = createServerSupabaseClient();

    // 1. Session + ownership
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) throw appError('UNAUTHENTICATED');
    ctx.userId = user.id;

    const { data: contract } = await supabase
      .from('contracts')
      .select('id, status, contract_text, page_count')
      .eq('id', params.id)
      .eq('user_id', user.id)
      .single();
    if (!contract) throw appError('NOT_FOUND');

    // 2. Must be processed
    if (contract.status !== 'completed') throw appError('NOT_PROCESSED');

    // Spec 08 v1.1 §D: the selected RetrievalStrategy. An unconfigured n8n
    // backend is 501 NOT_IMPLEMENTED (capability retrieval.n8n) here — after
    // the 401/404 checks, before anything is counted or stored.
    const strategy = getRetrievalStrategy();
    strategy.assertAvailable();

    // 3. Rate limit
    await enforceRateLimit(user.id, 'chat');

    const { message } = chatMessageSchema.parse(await request.json());

    // 4. Session
    const sessionId = await ensureSession(supabase, contract.id, user.id);

    // Full history, ascending — this is what enables memory-style questions.
    const { data: historyRows } = await supabase
      .from('chat_messages')
      .select('role, content')
      .eq('session_id', sessionId)
      .order('created_at', { ascending: true })
      .limit(cfg.MAX_CHAT_HISTORY_MESSAGES);

    const history = (historyRows ?? []) as HistoryMessage[];
    const turnStartedAt = Date.now();
    const screenOpts = { supabase, userId: user.id, contractId: contract.id };

    // 5. Persist the user message BEFORE the answer call, so a failed turn
    //    still records the question. `chat_messages` is append-only (no UPDATE
    //    policy), so `enhanced_query` is written with the row, not after it:
    //    the enhancer (6a) runs first, and it can never fail a turn.
    const persistUserMessage = async (enhancedQuery: string | null) => {
      const { data: row, error } = await supabase
        .from('chat_messages')
        .insert({ session_id: sessionId, user_id: user.id, role: 'user', content: message, enhanced_query: enhancedQuery })
        .select('id')
        .single();
      if (error || !row) throw appError('INTERNAL');
      return { id: row.id as string, enhanced_query: enhancedQuery };
    };

    /**
     * Steps 10–11 for every path (block, greeting, answer): persist the
     * assistant row, the unresolved-turn counter (spec 20 §5.1, step 10a),
     * telemetry and the one `chat` processing run.
     */
    const completeTurn = async (turn: {
      userMessage: { id: string; enhanced_query: string | null };
      content: string;
      citedPages: number[];
      citationVerified: boolean;
      queryClass: QueryClass | null;
      promptTokens?: number;
      completionTokens?: number;
      metadata: Record<string, unknown>;
    }) => {
      const latencyMs = Date.now() - turnStartedAt;
      const { data: assistantRow, error: assistantError } = await supabase
        .from('chat_messages')
        .insert({
          session_id: sessionId,
          user_id: user.id,
          role: 'assistant',
          content: turn.content,
          cited_pages: turn.citedPages,
          citation_verified: turn.citationVerified,
          query_class: turn.queryClass,
          latency_ms: latencyMs,
          prompt_tokens: turn.promptTokens ?? null,
          completion_tokens: turn.completionTokens ?? null,
        })
        .select('id, role, content, cited_pages, citation_verified, created_at')
        .single();
      if (assistantError || !assistantRow) throw appError('INTERNAL');

      await supabase
        .from('chat_sessions')
        .update({ last_message_at: new Date().toISOString() })
        .eq('id', sessionId);

      // 10a. Consecutive unresolved turns within the session's last 6 messages.
      const { data: recent } = await supabase
        .from('chat_messages')
        .select('role, content, citation_verified')
        .eq('session_id', sessionId)
        .order('created_at', { ascending: false })
        .limit(UNRESOLVED_WINDOW_MESSAGES);
      const unresolvedTurns = countUnresolvedTurns(((recent ?? []) as TurnRecord[]).reverse());
      const escalationOffer = unresolvedTurns >= ESCALATION_OFFER_THRESHOLD;
      // Rule 4: the offer fired — a flag event; the offer itself is UI, never model text.
      if (escalationOffer) await recordEscalationFlag(turn.content, screenOpts);

      // 11. Telemetry — class, latency and counts only, never the question or the answer.
      await Promise.all([
        recordEvent(supabase, {
          userId: user.id,
          contractId: contract.id,
          eventType: 'chat_message_sent',
          durationMs: latencyMs,
          metadata: { query_class: turn.queryClass, unresolved_turns: unresolvedTurns, ...turn.metadata },
        }),
        recordProcessingRun(supabase, { contractId: contract.id, userId: user.id, stage: 'chat', durationMs: latencyMs, outcome: 'success' }),
      ]);

      return Response.json({
        user_message_id: turn.userMessage.id,
        user_message: turn.userMessage,
        assistant_message: { ...assistantRow, query_class: turn.queryClass, latency_ms: latencyMs },
        escalation_offer: escalationOffer,
      });
    };

    // 5a. Inbound guardrail screen (spec 13 v1.1 §A): injection → off-scope →
    //     profanity. A block is answered with the rule's fixed reply and no
    //     model call; the guardrail_events row is written before it applies.
    const inbound = await screenInbound(message, { ...screenOpts, hasHistory: history.length > 0 });
    if (inbound.action === 'block') {
      const userMessage = await persistUserMessage(null);
      const blockedBy = inbound.matches.at(-1)!;
      return completeTurn({
        userMessage,
        content: inbound.replacement ?? OFF_SCOPE_REPLY,
        citedPages: [],
        citationVerified: true,
        queryClass: null,
        metadata: { guardrail: blockedBy.rule },
      });
    }

    // 5b. Greeting / small talk (spec 08 v1.1 §A): a fixed reply, and no
    //     classifier, enhancer, document or model call.
    if (isGreeting(message)) {
      const userMessage = await persistUserMessage(null);
      return completeTurn({
        userMessage,
        content: GREETING_REPLY,
        citedPages: [],
        citationVerified: true,
        queryClass: null,
        metadata: { greeting: true },
      });
    }

    // 6. Classify locally — no extra API call.
    const analysis = analyseQuery(message, history.length > 0);
    const queryClass = analysis.queryClass;

    // 6a. Query enhancer (§B, C28): only when the message carries no history
    //     signal. Never throws: a failure or timeout is null and the turn goes on.
    const enhancedQuery = shouldEnhanceQuery(analysis)
      ? await enhanceQuery({ question: message, history, userId: user.id, contractId: contract.id, deadlineAt, supabase })
      : null;

    const userMessage = await persistUserMessage(enhancedQuery);

    let content: string;
    let citation: { citedPages: number[]; citationVerified: boolean };
    let promptTokens: number | undefined;
    let completionTokens: number | undefined;
    try {
      // 7. Retrieval (spec 08 v1.1 §D): context blocks, or a delegated answer.
      const retrieval = await strategy.buildContext({
        contract: { id: contract.id, contract_text: contract.contract_text, page_count: contract.page_count },
        question: message,
        enhancedQuery: userMessage.enhanced_query,
        queryClass,
        history,
        deadlineAt,
      });

      if (retrieval.mode === 'delegated') {
        // 8–9. The external backend answered; the shared citation validation
        // decides what it may claim. No repair call — it is not ours to re-prompt.
        content = retrieval.answer;
        citation = validateDelegatedAnswer(retrieval.answer, retrieval.cited_pages, contract.page_count, queryClass);
      } else {
        const messages = assembleFromBlocks({
          queryClass,
          contextBlocks: retrieval.blocks,
          history,
          userMessage: message,
          maxHistoryTokens: cfg.MAX_CHAT_HISTORY_TOKENS,
        });

        // 8. Call GPT-4o — OPENAI_MAX_RETRIES attempts, all inside the turn budget.
        const result = await callLlm({
          purpose: 'chat',
          messages,
          temperature: cfg.OPENAI_CHAT_TEMPERATURE,
          maxTokens: cfg.OPENAI_CHAT_MAX_TOKENS,
          userId: user.id,
          contractId: contract.id,
          deadlineAt,
          supabase,
        });

        // 9. Citation post-validation, with one repair retry.
        content = result.content;
        const firstCitation = validateCitations(content, contract.page_count, queryClass);
        citation = firstCitation;
        promptTokens = result.promptTokens;
        completionTokens = result.completionTokens;

        if (firstCitation.needsRepair) {
          try {
            const repaired = await callLlm({
              purpose: 'repair',
              messages: [...messages, { role: 'assistant', content }, { role: 'user', content: CITATION_REPAIR_PROMPT }],
              temperature: cfg.OPENAI_CHAT_TEMPERATURE,
              maxTokens: cfg.OPENAI_CHAT_MAX_TOKENS,
              // One attempt, and only if the turn budget still has room for it.
              maxAttempts: 1,
              deadlineAt,
              userId: user.id,
              contractId: contract.id,
              supabase,
            });
            const repairedCitation = validateCitations(repaired.content, contract.page_count, queryClass);
            // Keep the repaired answer only if it actually cited a page.
            if (repairedCitation.citationVerified) {
              content = repaired.content;
              citation = repairedCitation;
            }
            promptTokens += repaired.promptTokens;
            completionTokens += repaired.completionTokens;
          } catch {
            // The original answer is still shown — the user keeps control.
          }
        }
      }
    } catch (err) {
      // §A step 10: one `chat` row per turn, failed turns included.
      await recordProcessingRun(supabase, {
        contractId: contract.id,
        userId: user.id,
        stage: 'chat',
        durationMs: Date.now() - turnStartedAt,
        outcome: 'error',
        errorCode: err instanceof AppError ? err.code : 'INTERNAL',
      });
      throw err;
    }

    // 9a. Outbound guardrail screen: profanity → competitor → PII. A rewrite
    //     replaces the stored content with the rule's fixed sentence, which
    //     cites nothing and so claims nothing to verify.
    const outbound = await screenOutbound(content, screenOpts);
    if (outbound.action === 'rewrite' && outbound.replacement) {
      content = outbound.replacement;
      citation = { citedPages: [], citationVerified: true };
    }

    return completeTurn({
      userMessage,
      content,
      citedPages: citation.citedPages,
      citationVerified: citation.citationVerified,
      queryClass,
      promptTokens,
      completionTokens,
      metadata: {
        enhanced: userMessage.enhanced_query !== null,
        ...(inbound.action === 'flag' ? { guardrail_flag: true } : {}),
        ...(outbound.action === 'rewrite' ? { guardrail_rewrite: true } : {}),
      },
    });
  });
}
