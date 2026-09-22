import 'server-only';
import { keyTermSchema } from '@/lib/validation/key-term.schema';
import { containsNormalised } from '@/lib/utils/normalise-text';
import { displayRankFor, isRequiredTerm, TERM_LIBRARY_VERSION } from '@/lib/ai/term-library';
import type { ContractType, DetectedType } from '@/types/domain';

/**
 * Post-processing pipeline (spec 06 §4). The step order is load-bearing.
 *
 * Capping at 49 rather than 50 is deliberate: 49 falls in the red `< 50` band,
 * which is what triggers the ⚠️ warning path (FR-11).
 */

const UNVERIFIED_CAP = 49;
export const REASONING_MAX_CHARS = 500;

/**
 * Spec 06 v1.1 §A: reasoning longer than 500 characters is truncated at the
 * last sentence boundary inside the limit (hard-cut when there is none) and
 * counted, never dropped.
 */
export function truncateReasoning(reasoning: string | null | undefined): {
  reasoning: string | null;
  truncated: boolean;
} {
  if (reasoning === null || reasoning === undefined) return { reasoning: null, truncated: false };
  const trimmed = reasoning.trim();
  if (trimmed.length === 0) return { reasoning: null, truncated: false };
  if (trimmed.length <= REASONING_MAX_CHARS) return { reasoning: trimmed, truncated: false };
  const window = trimmed.slice(0, REASONING_MAX_CHARS);
  const lastBoundary = Math.max(window.lastIndexOf('. '), window.lastIndexOf('.'), window.lastIndexOf('! '), window.lastIndexOf('? '));
  const cut = lastBoundary > 0 ? window.slice(0, lastBoundary + 1) : window;
  return { reasoning: cut.trim(), truncated: true };
}

/** Row shape passed to the persist_key_terms RPC. */
export interface PersistableTerm {
  term_name: string;
  value: string | null;
  page_number: number | null;
  confidence_score: number;
  source_sentence: string | null;
  is_source_verified: boolean;
  is_custom: boolean;
  display_rank: number;
  /** v1.1 (spec 06 v1.1 §A). */
  reasoning: string | null;
  is_required: boolean;
  term_library_version: string;
}

export interface ProcessedExtraction {
  terms: PersistableTerm[];
  droppedTermCount: number;
  /** v1.1: how many reasoning strings were truncated at 500 chars. */
  reasoningTruncatedCount: number;
  /** v1.1 (spec 06 v1.1 §C): required standard terms the model did not find. */
  requiredMissing: string[];
  detectedType: DetectedType;
  typeMismatch: boolean;
}

const NOT_FOUND_SENTINELS = new Set(['n/a', 'na', 'not found', 'none', 'not specified', 'null']);

function isNotFoundValue(value: string | null): boolean {
  if (value === null) return true;
  const trimmed = value.trim();
  if (trimmed.length === 0) return true;
  return NOT_FOUND_SENTINELS.has(trimmed.toLowerCase());
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function processExtraction(params: {
  raw: unknown;
  contractType: ContractType;
  contractText: string;
  pageCount: number;
  requestedStandardTerms: string[];
  requestedCustomTerms: string[];
}): ProcessedExtraction {
  const { raw, contractType, contractText, pageCount } = params;

  const payload = raw as { detected_type?: unknown; terms?: unknown };
  const detectedType: DetectedType =
    payload.detected_type === 'NDA' || payload.detected_type === 'MSA' ? payload.detected_type : 'OTHER';

  const rawTerms = Array.isArray(payload.terms) ? payload.terms : [];
  const customLower = new Set(params.requestedCustomTerms.map((t) => t.toLowerCase()));

  const processed: PersistableTerm[] = [];
  const seen = new Set<string>();
  let droppedTermCount = 0;
  let reasoningTruncatedCount = 0;

  for (const item of rawTerms) {
    // 1. zod parse — a failing item is dropped and counted, never persisted
    //    as a broken row.
    const parsed = keyTermSchema.safeParse(item);
    if (!parsed.success) {
      droppedTermCount += 1;
      continue;
    }
    const term = parsed.data;

    // The DB has a unique (contract_id, term_name) constraint; a duplicate from
    // the model would fail the whole transaction, so drop the later one.
    const key = term.term_name.trim().toLowerCase();
    if (seen.has(key)) {
      droppedTermCount += 1;
      continue;
    }
    seen.add(key);

    // 2. Confidence conversion — the single conversion point in the system.
    let confidence = Math.round(clamp(term.confidence_score, 0, 1) * 100);

    // 3. Page range check.
    let pageNumber = term.page_number;
    if (
      pageNumber === null ||
      !Number.isInteger(pageNumber) ||
      pageNumber < 1 ||
      pageNumber > pageCount
    ) {
      pageNumber = null;
      confidence = Math.min(confidence, UNVERIFIED_CAP);
    }

    // 4. Source verification.
    const sourceSentence =
      term.source_sentence && term.source_sentence.trim().length > 0
        ? term.source_sentence
        : null;
    const isSourceVerified =
      sourceSentence !== null && containsNormalised(contractText, sourceSentence);
    if (!isSourceVerified) confidence = Math.min(confidence, UNVERIFIED_CAP);

    // 5. Not-found normalisation.
    let value = term.value;
    if (isNotFoundValue(value)) {
      value = null;
      confidence = 0;
    }

    // 6. display_rank; custom terms get 99 and is_custom = true.
    const isCustom = customLower.has(key);
    const displayRank = isCustom ? 99 : displayRankFor(contractType, term.term_name);

    // 7 (v1.1). Reasoning: one sentence, ≤ 500 chars, truncated and counted.
    const { reasoning, truncated } = truncateReasoning(term.reasoning);
    if (truncated) reasoningTruncatedCount += 1;

    processed.push({
      term_name: term.term_name.trim(),
      value,
      page_number: pageNumber,
      confidence_score: confidence,
      source_sentence: sourceSentence,
      is_source_verified: isSourceVerified,
      is_custom: isCustom,
      display_rank: displayRank,
      reasoning,
      is_required: !isCustom && isRequiredTerm(contractType, term.term_name),
      term_library_version: TERM_LIBRARY_VERSION,
    });
  }

  // 8. Missing terms: any requested term absent from the model's array is
  //    inserted at 0%, so the panel always shows the complete requested set and
  //    the user learns what was searched for.
  const requested: Array<{ name: string; isCustom: boolean }> = [
    ...params.requestedStandardTerms.map((name) => ({ name, isCustom: false })),
    ...params.requestedCustomTerms.map((name) => ({ name, isCustom: true })),
  ];

  for (const { name, isCustom } of requested) {
    if (seen.has(name.toLowerCase())) continue;
    processed.push({
      term_name: name,
      value: null,
      page_number: null,
      confidence_score: 0,
      source_sentence: null,
      is_source_verified: false,
      is_custom: isCustom,
      display_rank: isCustom ? 99 : displayRankFor(contractType, name),
      reasoning: null,
      is_required: !isCustom && isRequiredTerm(contractType, name),
      term_library_version: TERM_LIBRARY_VERSION,
    });
  }

  processed.sort(
    (a, b) => a.display_rank - b.display_rank || a.term_name.localeCompare(b.term_name),
  );

  return {
    terms: processed,
    droppedTermCount,
    reasoningTruncatedCount,
    // §C: a required standard term with no value is flagged for review.
    requiredMissing: processed.filter((t) => t.is_required && t.value === null).map((t) => t.term_name),
    detectedType,
    // 10. Type sanity check (spec 06 §3 step 10).
    typeMismatch: detectedType !== contractType,
  };
}

/** Extracts the first JSON object from a model response that may be fenced. */
export function parseJsonResponse(content: string): unknown {
  const trimmed = content.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenced?.[1]) return JSON.parse(fenced[1].trim());
    const braced = trimmed.slice(trimmed.indexOf('{'), trimmed.lastIndexOf('}') + 1);
    if (braced.length > 1) return JSON.parse(braced);
    throw new SyntaxError('no JSON object in response');
  }
}
