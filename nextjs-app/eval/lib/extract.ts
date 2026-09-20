import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { SupabaseClient } from '@supabase/supabase-js';
import { callLlm } from '@/lib/ai/openai-client';
import {
  buildExtractionSystemPrompt,
  buildExtractionUserMessage,
} from '@/lib/ai/prompts/extraction.v1';
import { JSON_REPAIR_PROMPT } from '@/lib/ai/prompts/repair.v1';
import { processExtraction, parseJsonResponse, type PersistableTerm } from '@/lib/services/extraction-service';
import { termsFor } from '@/lib/ai/term-library';
import { getServerConfig } from '@/lib/utils/server-config';
import { ALL_CONTRACTS, customTermsFor, pageCountOf } from './dataset';

/**
 * Runs the SHIPPED extraction path — the same prompt builder, the same
 * callLlm, the same JSON-repair retry and the same processExtraction the
 * /process route uses (spec 17 §2: never a mock, so an eval result is a
 * statement about the production pipeline).
 *
 * Results are cached per release so the five runners that derive from
 * extraction share one set of billed calls rather than making five.
 */

export interface ExtractionRun {
  contract_id: string;
  terms: PersistableTerm[];
  detectedType: string;
  droppedTermCount: number;
  latencyMs: number;
  promptVersion: string;
  error?: string;
}

function cachePath(release: string): string {
  return resolve(process.cwd(), 'eval/reports/.cache', `${release}-extractions.json`);
}

export async function runExtractions(params: {
  supabase: SupabaseClient;
  operatorId: string;
  release: string;
  refresh: boolean;
  offline: boolean;
}): Promise<ExtractionRun[]> {
  const { supabase, operatorId, release, refresh, offline } = params;
  const path = cachePath(release);

  if (!refresh && existsSync(path)) {
    console.log(`  extraction: reusing cached run at ${path}`);
    return JSON.parse(readFileSync(path, 'utf8')) as ExtractionRun[];
  }

  // --offline must never bill. Without a cache there is nothing to score.
  if (offline) {
    throw new Error(
      `--offline was passed but there is no cached extraction run at ${path}. ` +
        'Run `npm run eval` once to produce one.',
    );
  }

  const cfg = getServerConfig();
  const runs: ExtractionRun[] = [];

  for (const contract of ALL_CONTRACTS) {
    const customTermNames = customTermsFor(contract.contract_id);
    const systemPrompt = buildExtractionSystemPrompt(contract.contract_type, customTermNames);
    const userMessage = buildExtractionUserMessage(contract.text);
    const startedAt = Date.now();

    try {
      const result = await callLlm({
        purpose: 'extraction',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage },
        ],
        jsonMode: true,
        temperature: cfg.OPENAI_EXTRACTION_TEMPERATURE,
        maxTokens: cfg.OPENAI_EXTRACTION_MAX_TOKENS,
        userId: operatorId,
        supabase,
      });

      let parsed: unknown;
      try {
        parsed = parseJsonResponse(result.content);
      } catch {
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
          userId: operatorId,
          supabase,
        });
        parsed = parseJsonResponse(repaired.content);
      }

      const processed = processExtraction({
        raw: parsed,
        contractType: contract.contract_type,
        contractText: contract.text,
        pageCount: pageCountOf(contract),
        requestedStandardTerms: termsFor(contract.contract_type).map((t) => t.term_name),
        requestedCustomTerms: customTermNames,
      });

      runs.push({
        contract_id: contract.contract_id,
        terms: processed.terms,
        detectedType: processed.detectedType,
        droppedTermCount: processed.droppedTermCount,
        latencyMs: Date.now() - startedAt,
        promptVersion: cfg.PROMPT_VERSION,
      });
      console.log(`  extraction: ${contract.contract_id} → ${processed.terms.length} terms (${Date.now() - startedAt}ms)`);
    } catch (error) {
      runs.push({
        contract_id: contract.contract_id,
        terms: [],
        detectedType: 'OTHER',
        droppedTermCount: 0,
        latencyMs: Date.now() - startedAt,
        promptVersion: cfg.PROMPT_VERSION,
        error: error instanceof Error ? error.message : String(error),
      });
      console.error(`  extraction: ${contract.contract_id} FAILED — ${String(error)}`);
    }
  }

  mkdirSync(resolve(process.cwd(), 'eval/reports/.cache'), { recursive: true });
  writeFileSync(path, JSON.stringify(runs, null, 2));
  return runs;
}
