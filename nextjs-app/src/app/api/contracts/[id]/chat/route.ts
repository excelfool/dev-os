import { createServerSupabaseClient } from '@/lib/supabase/server';
import { appError } from '@/lib/errors/app-error';
import { withErrorHandling } from '@/lib/errors/to-user-message';
import { enforceRateLimit } from '@/lib/security/rate-limit';
import { chatMessageSchema } from '@/lib/validation/chat.schema';
import { callLlm } from '@/lib/ai/openai-client';
import { classifyQuery } from '@/lib/ai/query-classifier';
import { detectPromptInjection } from '@/lib/security/prompt-injection';
import { CITATION_REPAIR_PROMPT } from '@/lib/ai/prompts/repair.v1';
import { assembleChatMessages, validateCitations, type HistoryMessage } from '@/lib/services/chat-service';
import { getServerConfig } from '@/lib/utils/server-config';
import { recordEvent } from '@/lib/metrics/events';

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
  return withErrorHandling({ route: '/api/contracts/[id]/chat', method: 'GET' }, async () => {
    const cfg = getServerConfig();
    const supabase = createServerSupabaseClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) throw appError('UNAUTHENTICATED');

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
  return withErrorHandling({ route: '/api/contracts/[id]/chat', method: 'POST' }, async () => {
    const cfg = getServerConfig();
    const supabase = createServerSupabaseClient();

    // 1. Session + ownership
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) throw appError('UNAUTHENTICATED');

    const { data: contract } = await supabase
      .from('contracts')
      .select('id, status, contract_text, page_count')
      .eq('id', params.id)
      .eq('user_id', user.id)
      .single();
    if (!contract) throw appError('NOT_FOUND');

    // 2. Must be processed
    if (contract.status !== 'completed') throw appError('NOT_PROCESSED');

    // 3. Rate limit
    await enforceRateLimit(user.id, 'chat');

    const { message } = chatMessageSchema.parse(await request.json());

    // Screened BEFORE the session is touched and before any model call, so a
    // blocked attempt costs nothing and leaves no conversation history.
    const injection = detectPromptInjection(message);
    if (injection.blocked) {
      await recordEvent(supabase, {
        userId: user.id,
        contractId: contract.id,
        eventType: 'prompt_injection_blocked',
        metadata: { rule: injection.rule },
      });
      throw appError('PROMPT_INJECTION');
    }

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

    // 5. Persist the user message BEFORE the model call, so a failed turn
    //    still records the question.
    const { data: userMessageRow, error: userInsertError } = await supabase
      .from('chat_messages')
      .insert({ session_id: sessionId, user_id: user.id, role: 'user', content: message })
      .select('id')
      .single();
    if (userInsertError || !userMessageRow) throw appError('INTERNAL');

    // 6. Classify locally — no extra API call.
    const queryClass = classifyQuery(message, history.length > 0);

    // 7. Assemble context
    const messages = assembleChatMessages({
      queryClass,
      contractText: contract.contract_text,
      history,
      userMessage: message,
      maxHistoryTokens: cfg.MAX_CHAT_HISTORY_TOKENS,
    });

    // 8. Call GPT-4o
    const startedAt = Date.now();
    const result = await callLlm({
      purpose: 'chat',
      messages,
      temperature: cfg.OPENAI_CHAT_TEMPERATURE,
      maxTokens: cfg.OPENAI_CHAT_MAX_TOKENS,
      userId: user.id,
      contractId: contract.id,
      supabase,
    });

    // 9. Citation post-validation, with one repair retry.
    let content = result.content;
    let citation = validateCitations(content, contract.page_count, queryClass);
    let promptTokens = result.promptTokens;
    let completionTokens = result.completionTokens;

    if (citation.needsRepair) {
      try {
        const repaired = await callLlm({
          purpose: 'repair',
          messages: [
            ...messages,
            { role: 'assistant', content },
            { role: 'user', content: CITATION_REPAIR_PROMPT },
          ],
          temperature: cfg.OPENAI_CHAT_TEMPERATURE,
          maxTokens: cfg.OPENAI_CHAT_MAX_TOKENS,
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

    const latencyMs = Date.now() - startedAt;

    // 10. Persist the assistant message
    const { data: assistantRow, error: assistantError } = await supabase
      .from('chat_messages')
      .insert({
        session_id: sessionId,
        user_id: user.id,
        role: 'assistant',
        content,
        cited_pages: citation.citedPages,
        citation_verified: citation.citationVerified,
        query_class: queryClass,
        latency_ms: latencyMs,
        prompt_tokens: promptTokens,
        completion_tokens: completionTokens,
      })
      .select('id, role, content, cited_pages, citation_verified, created_at')
      .single();
    if (assistantError || !assistantRow) throw appError('INTERNAL');

    await supabase
      .from('chat_sessions')
      .update({ last_message_at: new Date().toISOString() })
      .eq('id', sessionId);

    // 11. Telemetry — metadata carries the class and latency only, never the
    //     question or the answer.
    await recordEvent(supabase, {
      userId: user.id,
      contractId: contract.id,
      eventType: 'chat_message_sent',
      durationMs: latencyMs,
      metadata: { query_class: queryClass },
    });

    return Response.json({
      user_message_id: userMessageRow.id,
      assistant_message: { ...assistantRow, query_class: queryClass, latency_ms: latencyMs },
    });
  });
}
