/**
 * C25/C27 (spec 08 v1.1 §D, 2026-09-23): contracts the upload gates reject
 * before any model call, so no eval can score them. Each one is reported as a
 * SKIPPED row naming the gate and `retrieval.vector` — the capability that
 * would make it reachable — and is never counted as PASS.
 */
export interface ContractMeasurement {
  contract: string;
  pageCount: number;
  tokens: number;
}

export type BlockingGate = 'MAX_PAGES' | 'MAX_TOKENS';

export interface UploadLimits {
  maxPages: number;
  maxTokens: number;
}

export interface BlockedContractRow {
  contract: string;
  status: 'SKIPPED';
  gate: BlockingGate;
  page_count: number;
  tokens: number;
  reason: string;
}

/** The first gate that stops the contract, in the upload route's order: pages, then tokens. */
export function blockingGate(m: ContractMeasurement, limits: UploadLimits): BlockingGate | null {
  if (m.pageCount > limits.maxPages) return 'MAX_PAGES';
  if (m.tokens > limits.maxTokens) return 'MAX_TOKENS';
  return null;
}

/** One SKIPPED row per blocked contract; contracts inside both limits produce none. */
export function blockedContractRows(measurements: ContractMeasurement[], limits: UploadLimits): BlockedContractRow[] {
  return measurements.flatMap((m) => {
    const gate = blockingGate(m, limits);
    if (!gate) return [];
    const detail =
      gate === 'MAX_PAGES'
        ? `${m.pageCount} pages > MAX_PAGES=${limits.maxPages}`
        : `${m.tokens} tokens > MAX_TOKENS=${limits.maxTokens}`;
    return [
      {
        contract: m.contract,
        status: 'SKIPPED' as const,
        gate,
        page_count: m.pageCount,
        tokens: m.tokens,
        reason: `blocked by ${gate} (${detail}); needs retrieval.vector (chunked retrieval) to be scored`,
      },
    ];
  });
}
