import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { appError, AppError } from '@/lib/errors/app-error';
import { callLlm } from '@/lib/ai/openai-client';
import { buildExtractionSystemPrompt, buildExtractionUserMessage } from '@/lib/ai/prompts/extraction.v2';
import { JSON_REPAIR_PROMPT } from '@/lib/ai/prompts/repair.v1';
import {
  mergeExtractions,
  parseJsonResponse,
  planExtractionBatches,
  processExtraction,
  type ExtractionBatch,
  type ProcessedExtraction,
} from '@/lib/services/extraction-service';
import { shouldClaimSummaryInline, claimSummaryInline, runSummary } from '@/lib/services/summary-service';
import { deriveKeyDatesBounded } from '@/lib/services/reminder-service';
import { getServerConfig } from '@/lib/utils/server-config';
import { recordProcessingRun } from '@/lib/metrics/timings';
import { recordEvent } from '@/lib/metrics/events';
import type { ContractType } from '@/types/domain';

/**
 * The processing pipeline (spec 06 §3 steps 6–12): extraction → persist →
 * key dates → summary → telemetry. One implementation, two callers:
 *
 * - `POST /api/contracts/{id}/process` runs it inline under the 24 s request
 *   deadline (the synchronous fallback, spec 06 v1.1 §G);
 * - `netlify/functions/process-background.ts` runs it under a 120 s budget
 *   after the route has claimed the contract and returned 202 (D49 a).
 *
 * The caller owns the guards (auth, rate limit, status, semaphore) and the
 * `processing` claim; this module owns everything after the claim, including
 * persisting the error state when it fails.
 */

export interface PipelineContract {
  id: string;
  user_id: string;
  contract_type: string;
  contract_text: string;
  page_count: number;
  ocr_confidence: number | null;
}

export interface PipelineOptions {
  supabase: SupabaseClient;
  contract: PipelineContract;
  userId: string;
  /** When the run must be finished by (ms since epoch). */
  deadlineAt: number;
  /** When the caller's request/job began — `first_term_ready_ms` and `total` key off it. */
  startedAt: number;
}

export interface PipelineTerm {
  id: unknown;
  term_name: unknown;
  value: unknown;
  page_number: unknown;
  confidence_score: unknown;
  source_sentence: unknown;
  is_source_verified: unknown;
  is_custom: unknown;
  display_rank: unknown;
  reasoning: string | null;
  original_ai_page: number | null;
  original_ai_reasoning: string | null;
  is_required: boolean;
  page_edited: boolean;
  reasoning_edited: boolean;
}

export interface PipelineResult {
  contract_id: string;
  status: 'completed';
  detected_type: string;
  type_mismatch_warning: boolean;
  term_count: number;
  first_term_ready_ms: number;
  required_missing: string[];
  summary_status: string;
  summary_md?: string;
  ocr_confidence?: number;
  terms: PipelineTerm[];
}

/** Runs steps 6–12. Throws an AppError on failure AFTER persisting the error state. */
export async function runProcessingPipeline(opts: PipelineOptions): Promise<PipelineResult> {
  const { supabase, contract, userId, deadlineAt, startedAt } = opts;
  const cfg = getServerConfig();
  const contractType = contract.contract_type as ContractType;

  try {
    // 6. Custom terms. The PDF is never re-downloaded — contract_text is
    //    the single source of truth.
    const { data: customRows } = await supabase
      .from('custom_key_terms')
      .select('term_name')
      .eq('contract_id', contract.id)
      .order('created_at', { ascending: true });

    const customTermNames = (customRows ?? []).map((r) => r.term_name as string);
    const userMessage = buildExtractionUserMessage(contract.contract_text);

    // 7. D47 c — the standard terms run as parallel batches (MSA: ranks
    //    1–18 and 19–36; NDA: one), each with its own JSON-repair retry
    //    and its own openai_calls rows, under the shared deadline.
    const runBatch = async (batch: ExtractionBatch): Promise<ProcessedExtraction> => {
      const systemPrompt = buildExtractionSystemPrompt(contractType, batch.customTermNames, {
        standardTermNames: batch.standardTermNames,
      });
      const result = await callLlm({
        purpose: 'extraction',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage },
        ],
        jsonMode: true,
        temperature: cfg.OPENAI_EXTRACTION_TEMPERATURE,
        maxTokens: cfg.OPENAI_EXTRACTION_MAX_TOKENS,
        userId,
        contractId: contract.id,
        deadlineAt,
        supabase,
      });

      // 8. Parse. One JSON-repair retry per batch, not counted against the 3.
      let parsed: unknown;
      try {
        parsed = parseJsonResponse(result.content);
      } catch {
        if (deadlineAt - Date.now() < 6_000) throw appError('AI_INVALID_OUTPUT');
        try {
          const repaired = await callLlm({
            purpose: 'repair',
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: userMessage },
              { role: 'assistant', content: result.content },
              { role: 'user', content: JSON_REPAIR_PROMPT },
            ],
            jsonMode: true,
            temperature: cfg.OPENAI_EXTRACTION_TEMPERATURE,
            maxTokens: cfg.OPENAI_EXTRACTION_MAX_TOKENS,
            userId,
            contractId: contract.id,
            deadlineAt,
            supabase,
          });
          parsed = parseJsonResponse(repaired.content);
        } catch {
          throw appError('AI_INVALID_OUTPUT');
        }
      }

      // 9 + 10. Validate, ground and type-check every term of this batch.
      return processExtraction({
        raw: parsed,
        contractType,
        contractText: contract.contract_text,
        pageCount: contract.page_count,
        requestedStandardTerms: batch.standardTermNames,
        requestedCustomTerms: batch.customTermNames,
      });
    };

    const aiStartedAt = Date.now();
    const parts = await Promise.all(planExtractionBatches(contractType, customTermNames).map(runBatch));
    const aiExtractMs = Date.now() - aiStartedAt; // wall time of the parallel pair
    const processed = mergeExtractions(parts, contractType);

    if (processed.typeDisagreement) {
      await recordEvent(supabase, {
        userId,
        contractId: contract.id,
        eventType: 'extraction_type_disagreement',
        metadata: { detected_types: parts.map((p) => p.detectedType).join(',') },
      });
    }

    // 11. Single transaction via the RPC — PostgREST exposes no
    //     multi-statement transaction, so partial key_terms can never
    //     survive a failure.
    const persistStartedAt = Date.now();
    const firstTermReadyMs = Date.now() - startedAt;

    const { data: persistedTerms, error: persistError } = await supabase.rpc('persist_key_terms', {
      p_contract_id: contract.id,
      p_terms: processed.terms,
      p_detected_type: processed.detectedType,
      p_type_mismatch: processed.typeMismatch,
      p_first_term_ready_ms: firstTermReadyMs,
    });

    if (persistError) throw appError('INTERNAL');
    const persistMs = Date.now() - persistStartedAt;

    // 11c. Key-date derivation (spec 21 §7.2): pure DB work, bounded to
    //      1 s, never fails the run — the terms are already committed.
    await deriveKeyDatesBounded(supabase, contract.id, userId, contractType);

    // 11a. Contract summary (spec 06 v1.1 §B, D45): claim first, only
    //      when ≥ 15 s of the budget remain; otherwise defer to route 34.
    let summaryStatus: string = 'pending';
    let summaryMd: string | null = null;
    if (shouldClaimSummaryInline(deadlineAt - Date.now())) {
      const claimed = await claimSummaryInline(supabase, contract.id, userId);
      if (claimed) {
        const summary = await runSummary(
          supabase,
          { id: contract.id, user_id: userId, contract_text: contract.contract_text, page_count: contract.page_count },
          processed.terms,
          { deadlineAt },
        );
        summaryStatus = summary.summary_status;
        summaryMd = summary.summary_md;
      } else {
        // A results-page poll already claimed it via POST /summary.
        summaryStatus = 'processing';
      }
    } else {
      await recordEvent(supabase, {
        userId,
        contractId: contract.id,
        eventType: 'summary_deferred',
        durationMs: Date.now() - startedAt,
      });
    }

    // 12. Telemetry.
    await Promise.all([
      recordProcessingRun(supabase, { contractId: contract.id, userId, stage: 'ai_extract', durationMs: aiExtractMs, outcome: 'success' }),
      recordProcessingRun(supabase, { contractId: contract.id, userId, stage: 'persist', durationMs: persistMs, outcome: 'success' }),
      recordProcessingRun(supabase, { contractId: contract.id, userId, stage: 'total', durationMs: Date.now() - startedAt, outcome: 'success' }),
    ]);

    if (processed.droppedTermCount > 0 || processed.anchorOverLimitCount > 0) {
      console.warn(
        JSON.stringify({
          extraction: 'post_processing',
          contractId: contract.id,
          droppedTermCount: processed.droppedTermCount,
          anchorOverLimitCount: processed.anchorOverLimitCount,
          reasoningTruncatedCount: processed.reasoningTruncatedCount,
        }),
      );
    }

    const terms = (persistedTerms ?? []) as Array<Record<string, unknown>>;
    const byName = new Map(processed.terms.map((t) => [t.term_name.toLowerCase(), t]));
    const ocrConfidence = typeof contract.ocr_confidence === 'number' ? contract.ocr_confidence : null;

    return {
      contract_id: contract.id,
      status: 'completed',
      detected_type: processed.detectedType,
      type_mismatch_warning: processed.typeMismatch,
      term_count: terms.length,
      first_term_ready_ms: firstTermReadyMs,
      required_missing: processed.requiredMissing,
      summary_status: summaryStatus,
      ...(summaryMd !== null ? { summary_md: summaryMd } : {}),
      ...(ocrConfidence !== null ? { ocr_confidence: ocrConfidence } : {}),
      terms: terms.map((t) => {
        const p = byName.get(String(t.term_name).toLowerCase());
        const reasoning = (t.reasoning as string | null | undefined) ?? p?.reasoning ?? null;
        return {
          id: t.id,
          term_name: t.term_name,
          value: t.value,
          page_number: t.page_number,
          confidence_score: t.confidence_score,
          source_sentence: t.source_sentence,
          is_source_verified: t.is_source_verified,
          is_custom: t.is_custom,
          display_rank: t.display_rank,
          reasoning,
          original_ai_page: (t.original_ai_page as number | null | undefined) ?? (t.page_number as number | null) ?? null,
          original_ai_reasoning: (t.original_ai_reasoning as string | null | undefined) ?? reasoning,
          is_required: (t.is_required as boolean | undefined) ?? p?.is_required ?? false,
          page_edited: (t.page_edited as boolean | undefined) ?? false,
          reasoning_edited: (t.reasoning_edited as boolean | undefined) ?? false,
        };
      }),
    };
  } catch (err) {
    const appErr = err instanceof AppError ? err : appError('INTERNAL');
    await persistPipelineFailure(supabase, contract.id, userId, appErr, Date.now() - startedAt);
    throw appErr;
  }
}

/**
 * On any unrecoverable failure the error state is persisted so the user
 * retries WITHOUT re-uploading, and no partial terms are kept.
 */
export async function persistPipelineFailure(
  supabase: SupabaseClient,
  contractId: string,
  userId: string,
  appErr: AppError,
  durationMs: number,
): Promise<void> {
  await supabase
    .from('contracts')
    .update({
      status: 'error',
      error_code: appErr.code,
      error_message: appErr.userMessage,
      processing_started_at: null,
    })
    .eq('id', contractId)
    .eq('user_id', userId);

  await recordProcessingRun(supabase, {
    contractId,
    userId,
    stage: 'total',
    durationMs,
    outcome: 'error',
    errorCode: appErr.code,
  });
}
