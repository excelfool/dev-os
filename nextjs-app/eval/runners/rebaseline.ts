import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { SupabaseClient } from '@supabase/supabase-js';
import { loadEnv } from '../lib/runtime';

loadEnv();

import { callLlm } from '@/lib/ai/openai-client';
import * as promptV1 from '@/lib/ai/prompts/extraction.v1';
import * as promptV2 from '@/lib/ai/prompts/extraction.v2';
import { JSON_REPAIR_PROMPT } from '@/lib/ai/prompts/repair.v1';
import { processExtraction, parseJsonResponse, type PersistableTerm } from '@/lib/services/extraction-service';
import { MSA_TERMS, TERM_LIBRARY_VERSION, MSA_LIBRARY_SOURCE_VERSION } from '@/lib/ai/term-library';
import { computeCostUsd } from '@/lib/metrics/cost';
import { getServerConfig } from '@/lib/utils/server-config';
import { matchValues, type MatchRule } from '../lib/matching';
import { scoreF1, type TermOutcome } from './extraction-f1';
import { pageAccuracy } from './page-accuracy';
import { calibration } from './calibration';
import { ingestInstructorSet, type IngestResult } from '../datasets/msa-instructor/ingest';

/**
 * Re-baseline against the instructor golden set (spec 22 §1, PRD R-21):
 *
 *   npm run eval -- --dataset msa-instructor --prompt v1
 *   npm run eval -- --dataset msa-instructor --prompt v2
 *
 * Each run scores one prompt version over the ingested contracts and MERGES
 * its block into eval/reports/rebaseline-2026-09-21.json, so both versions sit
 * side by side. This runner NEVER touches Supabase: the OpenAI client's
 * telemetry writer is handed a no-op client. With no OPENAI_API_KEY it writes a
 * SKIPPED block and exits 0.
 */

export type PromptVersion = 'v1' | 'v2';
export const MATCHER_VERSION = 'v2' as const;
export const REBASELINE_REPORT = resolve(process.cwd(), 'eval/reports/rebaseline-2026-09-21.json');

/** A SupabaseClient stand-in whose only reachable call, `from().insert()`, is a no-op. */
function noopSupabase(): SupabaseClient {
  const insert = async () => ({ error: null, data: null });
  return { from: () => ({ insert }) } as unknown as SupabaseClient;
}

interface RawRun {
  contract_id: string;
  terms: PersistableTerm[];
  detectedType: string;
  droppedTermCount: number;
  reasoningTruncatedCount: number;
  latencyMs: number;
  promptTokens: number;
  completionTokens: number;
  repairCalls: number;
  error?: string;
}

function cachePath(key: string): string {
  return resolve(process.cwd(), 'eval/reports/.cache', `rebaseline-2026-09-21-${key}.json`);
}

function blockKey(prompt: PromptVersion, opts: { maxTokens?: number }): string {
  return opts.maxTokens ? `${prompt}_max${opts.maxTokens}` : prompt;
}

function readReport(): Record<string, unknown> {
  if (!existsSync(REBASELINE_REPORT)) return {};
  return JSON.parse(readFileSync(REBASELINE_REPORT, 'utf8')) as Record<string, unknown>;
}

function writeReport(block: Record<string, unknown>): void {
  mkdirSync(resolve(process.cwd(), 'eval/reports'), { recursive: true });
  const merged = { ...readReport(), ...block, updated_at: new Date().toISOString() };
  writeFileSync(REBASELINE_REPORT, JSON.stringify(merged, null, 2) + '\n');
}

function classify(runs: RawRun[], ingest: IngestResult): TermOutcome[] {
  const outcomes: TermOutcome[] = [];
  for (const run of runs) {
    const contract = ingest.contracts.find((c) => c.contract_id === run.contract_id)!;
    for (const expected of contract.terms) {
      const actual = run.terms.find((t) => t.term_name === expected.term_name);
      const actualValue = actual?.value ?? null;
      let outcome: TermOutcome['outcome'];
      let rule: MatchRule = 'none';
      if (expected.expected_value === null && actualValue === null) outcome = 'tn';
      else if (expected.expected_value === null && actualValue !== null) outcome = 'fp';
      else if (expected.expected_value !== null && actualValue === null) outcome = 'fn';
      else {
        const match = matchValues(expected.expected_value!, actualValue!, MATCHER_VERSION);
        rule = match.rule;
        outcome = match.matched ? 'tp' : 'wrong';
      }
      outcomes.push({
        contract_id: run.contract_id,
        contract_type: 'MSA',
        term_name: expected.term_name,
        expected: expected.expected_value,
        actual: actualValue,
        expectedPage: expected.expected_page,
        actualPage: actual?.page_number ?? null,
        confidence: actual?.confidence_score ?? 0,
        outcome,
        rule,
      });
    }
  }
  return outcomes;
}

async function extractAll(prompt: PromptVersion, ingest: IngestResult, opts: RebaselineOptions): Promise<RawRun[]> {
  const { refresh } = opts;
  const path = cachePath(blockKey(prompt, opts));
  if (!refresh && existsSync(path)) {
    console.log(`  extraction: reusing cached ${prompt} run at ${path}`);
    return JSON.parse(readFileSync(path, 'utf8')) as RawRun[];
  }

  const cfg = getServerConfig();
  const maxTokens = opts.maxTokens ?? cfg.OPENAI_EXTRACTION_MAX_TOKENS;
  const builder = prompt === 'v1' ? promptV1 : promptV2;
  const supabase = noopSupabase();
  const requested = MSA_TERMS.map((t) => t.term_name);
  const runs: RawRun[] = [];

  for (const contract of ingest.contracts) {
    const systemPrompt = builder.buildExtractionSystemPrompt('MSA', []);
    const userMessage = builder.buildExtractionUserMessage(contract.text);
    const startedAt = Date.now();
    let promptTokens = 0;
    let completionTokens = 0;
    let repairCalls = 0;
    try {
      const result = await callLlm({
        purpose: 'extraction',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage },
        ],
        jsonMode: true,
        temperature: cfg.OPENAI_EXTRACTION_TEMPERATURE,
        maxTokens,
        userId: 'eval-rebaseline',
        timeoutMs: opts.timeoutMs,
        supabase,
      });
      promptTokens += result.promptTokens;
      completionTokens += result.completionTokens;

      let parsed: unknown;
      try {
        parsed = parseJsonResponse(result.content);
      } catch {
        repairCalls += 1;
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
          maxTokens,
          userId: 'eval-rebaseline',
          timeoutMs: opts.timeoutMs,
          supabase,
        });
        promptTokens += repaired.promptTokens;
        completionTokens += repaired.completionTokens;
        parsed = parseJsonResponse(repaired.content);
      }

      const processed = processExtraction({
        raw: parsed,
        contractType: 'MSA',
        contractText: contract.text,
        pageCount: [...contract.text.matchAll(/^\[PAGE (\d+)\]$/gm)].length,
        requestedStandardTerms: requested,
        requestedCustomTerms: [],
      });
      runs.push({
        contract_id: contract.contract_id,
        terms: processed.terms,
        detectedType: processed.detectedType,
        droppedTermCount: processed.droppedTermCount,
        reasoningTruncatedCount: processed.reasoningTruncatedCount,
        latencyMs: Date.now() - startedAt,
        promptTokens,
        completionTokens,
        repairCalls,
      });
      console.log(`  ${prompt} ${contract.contract_id}: ${processed.terms.filter((t) => t.value !== null).length}/${processed.terms.length} values (${Date.now() - startedAt}ms, ${promptTokens}+${completionTokens} tok)`);
    } catch (error) {
      runs.push({
        contract_id: contract.contract_id,
        terms: [],
        detectedType: 'OTHER',
        droppedTermCount: 0,
        reasoningTruncatedCount: 0,
        latencyMs: Date.now() - startedAt,
        promptTokens,
        completionTokens,
        repairCalls,
        error: error instanceof Error ? error.message : String(error),
      });
      console.error(`  ${prompt} ${contract.contract_id}: FAILED — ${String(error)}`);
    }
  }

  mkdirSync(resolve(process.cwd(), 'eval/reports/.cache'), { recursive: true });
  writeFileSync(path, JSON.stringify(runs, null, 2));
  return runs;
}

export interface RebaselineOptions {
  refresh: boolean;
  /** Diagnostic override of OPENAI_EXTRACTION_MAX_TOKENS; the block is keyed `<prompt>_max<N>` when set. */
  maxTokens?: number;
  /** Per-attempt timeout for the eval (a 3,000-token JSON answer takes ~60 s; production's 20 s is not the subject here). */
  timeoutMs: number;
}

export async function runRebaseline(prompt: PromptVersion, opts: RebaselineOptions): Promise<number> {
  console.log(`\nContractIQ re-baseline · instructor MSA golden set · prompt ${prompt} · matcher ${MATCHER_VERSION}`);
  const ingest = await ingestInstructorSet();
  for (const s of ingest.skipped) console.log(`  SKIPPED ${s.tab}: ${s.reason}`);
  console.log(`  ${ingest.contracts.length} contract(s) ingested from ${ingest.version}`);

  const baseBlock = {
    dataset: 'msa-instructor',
    golden_set_version: ingest.version,
    term_library_version: TERM_LIBRARY_VERSION,
    msa_library_source_version: MSA_LIBRARY_SOURCE_VERSION,
    previous_library_version: 'v1.0',
    matcher_version: MATCHER_VERSION,
    contracts_ingested: ingest.contracts.map((c) => c.contract_id),
    skipped: ingest.skipped,
  };

  if (!process.env.OPENAI_API_KEY) {
    writeReport({
      ...baseBlock,
      [blockKey(prompt, opts)]: { status: 'SKIPPED', reason: 'OPENAI_API_KEY is not set — no model calls were made' },
    });
    console.log(`  ${prompt}: SKIPPED (OPENAI_API_KEY not set) → ${REBASELINE_REPORT}`);
    return 0;
  }
  if (ingest.contracts.length === 0) {
    writeReport({ ...baseBlock, [blockKey(prompt, opts)]: { status: 'SKIPPED', reason: 'no instructor PDFs could be ingested' } });
    console.log(`  ${prompt}: SKIPPED (nothing ingested)`);
    return 0;
  }

  const key = blockKey(prompt, opts);
  const runs = await extractAll(prompt, ingest, opts);
  const scored = runs.filter((r) => !r.error);
  const outcomes = classify(scored, ingest);
  const f1 = scoreF1(outcomes);
  const pages = pageAccuracy(outcomes);
  const calib = calibration(outcomes);
  // scoreF1 returns 1.0 on an empty set; a block with nothing scored reports null.
  const nothingScored = outcomes.length === 0;
  const nullF1 = { precision: null, recall: null, f1: null, tp: 0, fp: 0, fn: 0, tn: 0 };
  const byTerm = nothingScored
    ? {}
    : Object.fromEntries(
        MSA_TERMS.map((t) => [t.term_name, scoreF1(outcomes.filter((o) => o.term_name === t.term_name))]),
      );
  const perContract = runs.map((r) => {
    const own = outcomes.filter((o) => o.contract_id === r.contract_id);
    const cost = computeCostUsd(r.promptTokens, r.completionTokens);
    return {
      contract_id: r.contract_id,
      error: r.error ?? null,
      terms: r.terms.length,
      values_found: r.terms.filter((t) => t.value !== null).length,
      ...scoreF1(own),
      page_accuracy: pageAccuracy(own).accuracy,
      prompt_tokens: r.promptTokens,
      completion_tokens: r.completionTokens,
      cost_usd: cost,
      latency_ms: r.latencyMs,
      repair_calls: r.repairCalls,
      reasoning_truncated: r.reasoningTruncatedCount,
      dropped_terms: r.droppedTermCount,
    };
  });
  const promptTokens = runs.reduce((n, r) => n + r.promptTokens, 0);
  const completionTokens = runs.reduce((n, r) => n + r.completionTokens, 0);
  const totalCost = computeCostUsd(promptTokens, completionTokens);
  const byRule = Object.fromEntries(
    [...new Set(outcomes.filter((o) => o.outcome === 'tp').map((o) => o.rule))].map((rule) => [
      rule,
      outcomes.filter((o) => o.outcome === 'tp' && o.rule === rule).length,
    ]),
  );

  const block = {
    status: scored.length > 0 ? 'MEASURED' : 'FAIL',
    prompt_version: prompt === 'v1' ? 'v1.0' : 'v2.0',
    max_tokens: opts.maxTokens ?? getServerConfig().OPENAI_EXTRACTION_MAX_TOKENS,
    timeout_ms: opts.timeoutMs,
    note: opts.maxTokens
      ? 'DIAGNOSTIC: max_tokens overridden above the shipped OPENAI_EXTRACTION_MAX_TOKENS; not the production setting.'
      : 'Production extraction settings (temperature, max_tokens); eval-only per-attempt timeout.',
    model: process.env.OPENAI_MODEL_EXTRACTION || process.env.OPENAI_MODEL || 'gpt-4o',
    n_contracts: scored.length,
    n_failed: runs.length - scored.length,
    failures: runs.filter((r) => r.error).map((r) => ({ contract_id: r.contract_id, error: r.error })),
    n_term_rows: outcomes.length,
    f1: nothingScored ? { ...nullF1, by_rule: {} } : { ...f1, by_rule: byRule },
    page_accuracy: pages,
    calibration: calib,
    cost: {
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      total_usd: totalCost,
      per_contract_usd: scored.length ? Number((totalCost / runs.length).toFixed(4)) : null,
    },
    per_term_f1: byTerm,
    per_contract: perContract,
    generated_at: new Date().toISOString(),
  };
  writeReport({ ...baseBlock, [key]: block });

  if (scored.length === 0) console.log(`\n  ${key}: FAIL — every contract failed (see failures in the report)`);
  else console.log(`\n  ${key}: F1 ${(f1.f1 * 100).toFixed(1)}%  P ${(f1.precision * 100).toFixed(1)}%  R ${(f1.recall * 100).toFixed(1)}%  page ${pages.accuracy === null ? 'n/a' : (pages.accuracy * 100).toFixed(1) + '%'}  calibration err ${calib.error === null ? 'n/a' : calib.error.toFixed(3)}  cost $${totalCost.toFixed(4)} (${promptTokens}+${completionTokens} tok) over ${scored.length} contract(s)`);
  console.log(`  report: ${REBASELINE_REPORT}\n`);
  return 0;
}
