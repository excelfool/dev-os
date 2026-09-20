# 06 — Key-Term Extraction Pipeline (OpenAI GPT-4o)

**Requirements:** US-011-partial, US-003, US-004, FR-04, FR-11, PRD §7 grounding, §8 prompt strategy, §9 hallucination guardrails; engineering-doc §4.3 (process block), §8.1–§8.4, §9.4.
**Provider:** OpenAI GPT-4o via the OpenAI API. No other provider is configured or called.

---

## 1. `src/lib/ai/openai-client.ts` — the only place the API key is used

```ts
export interface LlmCallOptions {
  purpose: 'extraction' | 'chat' | 'repair';
  messages: ChatMessageParam[];
  jsonMode?: boolean;
  temperature: number;
  maxTokens: number;
  userId: string;          // sent as OpenAI `user` (abuse tracing; PRD §5 GDPR line)
  contractId?: string;
  timeoutMs?: number;      // per-attempt, default 20_000
  deadlineAt?: number;     // epoch ms; no attempt is started that cannot finish before this
}
export interface LlmResult {
  content: string;
  promptTokens: number; completionTokens: number;
  latencyMs: number; attempts: number;
}
export async function callLlm(opts: LlmCallOptions): Promise<LlmResult>;
```

Behaviour, non-negotiable:
- Model: `serverConfig.OPENAI_MODEL` (`gpt-4o`, ≥ 128k context).
- `response_format: { type: 'json_object' }` when `jsonMode`.
- `user: opts.userId` on **every** call.
- Per-attempt timeout 20 s (`AbortController`).
- **Up to 3 attempts** with exponential backoff + jitter: 1 s, 2 s, 4 s (±25% jitter). Retry only on timeout, network error, `429`, or `5xx`. A `400`-class error is not retried. When `deadlineAt` is set, an attempt is started only if ≥ 6 s remain, and its timeout is `min(timeoutMs, remaining − 1 s)` — see §3a for why the caller sets a 24 s deadline.
- Every attempt — success or failure — writes one `openai_calls` row: `purpose`, `model`, `prompt_tokens`, `completion_tokens`, `cost_usd` (from `computeCostUsd`), `latency_ms`, `attempt`, `outcome` (`success|timeout|error|invalid_json`), `prompt_version`.
- On exhaustion: throws `AI_TIMEOUT` if the last failure was a timeout, else `AI_UNAVAILABLE`.
- The key is read once from `serverConfig.OPENAI_API_KEY`. The file starts with `import 'server-only'`.
- **Provider neutrality (A-fallback):** the module implements an internal `LlmProvider` interface with model id and pricing in config, so a future Claude/Gemini adapter is a config + adapter change. **No fallback provider is wired at MVP** — do not add one.

---

## 2. `src/lib/ai/prompts/extraction.v1.ts`

Composed in this fixed order (PRD §8, engineering-doc §8.2):

1. **Role and constraints.** "You extract key terms from a single contract. Extract only from the supplied document text. Never infer from general legal knowledge. If a term is not present in the document, return `value: null` with a low confidence score — do not guess."
2. **Few-shot block — 3 labelled NDA examples and 3 labelled MSA examples**, each an input excerpt (with `[PAGE N]` markers) followed by the exact JSON output it should produce. These are hard-coded in the module and are what closes the zero-shot→few-shot F1 gap.
3. **Target term list** — `termsFor(contract_type)` rendered as `- {term_name}: {guidance}`, followed by the user's custom term names appended **zero-shot** under the heading "Additional terms the user asked for:".
4. **Output contract** — a single JSON object:
```json
{ "detected_type": "NDA" | "MSA" | "OTHER",
  "terms": [ { "term_name": "string",
               "value": "string|null",
               "page_number": 1,
               "confidence_score": 0.0,
               "source_sentence": "string|null" } ] }
```
5. **Grounding rules** — `page_number` must be the 1-indexed page from the nearest preceding `[PAGE N]` marker; `source_sentence` must be **copied verbatim** from the document; `confidence_score` is a float 0.0–1.0 reflecting the model's own certainty; return exactly one object per requested term, standard and custom, in the order given.

The user message is the full `contracts.contract_text`, unmodified, markers included.

`repair.v1.ts` holds the JSON-repair prompt, verbatim: *"Your previous response was not valid JSON. Return only the JSON object described, with no explanation."*

---

## 3. `POST /api/contracts/{id}/process`

`runtime = 'nodejs'`. Request body `{}` (idempotent by contract). Rate limit 10/hr/user; global in-flight cap 100.

| # | Step | Failure behaviour |
|---|---|---|
| 1 | Session + ownership | `401` / `404` |
| 2 | **Status guard.** `'uploaded'` or `'error'` → proceed (the retry path: an errored contract is re-processed **without re-uploading**). `'processing'` → `409 ALREADY_PROCESSING`, **unless** its `processing_started_at` is older than 5 minutes, in which case the row is stale and the request re-claims it (§3a). `'completed'` → `409 ALREADY_PROCESSED` — a user may not re-run a successful extraction, which keeps the route idempotent per contract and prevents duplicate OpenAI spend. An operator re-run is performed by first setting `status='error'` in the Supabase dashboard, which returns the contract to the retry path; there is no separate code path or endpoint | `409` |
| 3 | Rate limit (`process`, 10/hr) | `429` + `Retry-After` |
| 4 | Concurrency slot via `withAnalysisSlot()` (spec 13 §6) — claims one of the 100 `analysis_slots` rows with `FOR UPDATE SKIP LOCKED`, queues 250 ms at a time for up to 5 s, and **always releases in `finally`**. **Not** an advisory lock: session-scoped locks do not survive Supabase's connection pool | `503 CAPACITY` |
| 5 | `UPDATE contracts SET status='processing', processing_started_at=now()` and write `activity_events` `process_started`. `processing_started_at` — **not** `updated_at` — is what both staleness rules key on (§3a) | — |
| 6 | Load `contract_text`, `page_count`, `contract_type`, plus `custom_key_terms` names. **The PDF is never re-downloaded.** | — |
| 7 | Build the prompt (§2) and call GPT-4o: JSON mode, temperature **0.1**, `max_tokens` **2000**, `user=<user_id>`, 20 s per-attempt timeout, up to 3 attempts **within a 24 s total request deadline** (§3a) | `503 AI_UNAVAILABLE` / `504 AI_TIMEOUT` |
| 8 | Parse JSON. On parse failure issue **one** JSON-repair retry (not counted against the 3). Still invalid → `502 AI_INVALID_OUTPUT` | `502` |
| 9 | Validate and ground every term (§4) | invalid items dropped and counted |
| 10 | Type sanity check: `detected_type !== contract_type` → `type_mismatch_warning = true` | — |
| 11 | **Single transaction.** PostgREST/supabase-js exposes no multi-statement transaction, so the whole step is one `rpc('persist_key_terms', { p_contract_id, p_terms, p_detected_type, p_type_mismatch, p_first_term_ready_ms })` call on the **caller's JWT** (spec 02 §3). Inside that function: delete the contract's existing `key_terms`, insert all validated rows (with `original_ai_value = value`), then `UPDATE contracts SET status='completed', processed_at=now(), detected_type=…, type_mismatch_warning=…, first_term_ready_ms=…, error_code=NULL, error_message=NULL`, returning the rows ordered by `display_rank, term_name` | any error inside the function rolls the whole function back — **no partial `key_terms` rows are ever kept**. A `NOT_FOUND` raise means the caller does not own the contract |
| 12 | Telemetry: `processing_runs` rows for `ai_extract`, `persist` and `total`; `activity_events` `results_viewed` is written by the results page, not here | — |

### 3a. Request deadline, and why a contract can never stick in `processing`

The Netlify function ceiling is **26 s** (Pro tier, spec 00 §6), while 3 × 20 s attempts plus a repair retry would exceed it. The handler therefore enforces its own **24 s total deadline**, measured from request start:

- Attempt 1 runs with the full 20 s timeout.
- A retry (or the JSON-repair call) is only started if the **remaining** budget is ≥ 6 s; its timeout is `min(20 s, remaining − 1 s)`.
- When the budget is exhausted the handler stops retrying immediately, persists `status='error'` with `AI_TIMEOUT`, and returns `504` — inside the function ceiling, so the user always gets the retryable error state rather than a killed request.

This also keeps the run inside the PRD's ≤ 30 s end-to-end P95.

**Why `processing_started_at` and not `updated_at`:** while a contract is processing, the results page polls `GET /api/contracts/{id}` every 2 s, and that route touches `last_accessed_at`, which fires the `set_contracts_updated_at` trigger. Keying staleness off `updated_at` would mean a killed run never looks stale while the user's tab is open — exactly the case this rule exists to catch. `processing_started_at` is written only at step 5 and cleared by `persist_key_terms` on success, so nothing else can move it.

**Stale-`processing` reclaim (defence in depth).** If the function is killed anyway — cold-start eviction, platform timeout, crash — the row would otherwise stay `'processing'` forever, `/process` would answer `409 ALREADY_PROCESSING` on every retry and the results page would poll indefinitely. Two rules prevent that:

1. **In the handler:** step 2 treats `status='processing'` with `processing_started_at` older than **5 minutes** as stale and proceeds (re-claiming the contract) instead of returning `409`.
2. **Scheduled:** the `reclaim-stale-processing` pg_cron job runs **every 5 minutes** and flips any `'processing'` row whose `processing_started_at` is older than 5 minutes to `status='error'`, `error_code='AI_TIMEOUT'`, with the standard retryable message — so the dashboard shows "Failed" with a Retry action and the user recovers without an operator (spec 14 §4, `supabase-schema.sql` §17).

**On unrecoverable failure (steps 7–11):** `UPDATE contracts SET status='error', error_code=…, error_message=…`, release the semaphore, and return the error envelope. The user sees a human-readable message plus a **"Try again in a few minutes"** CTA that re-invokes `/process` **without re-uploading**.

**Success `200`** — shape exactly as engineering-doc §9.4:
```json
{ "contract_id": "uuid", "status": "completed", "detected_type": "NDA",
  "type_mismatch_warning": false, "term_count": 13, "first_term_ready_ms": 11420,
  "terms": [ { "id", "term_name", "value", "page_number", "confidence_score",
               "source_sentence", "is_source_verified", "is_custom", "display_rank" } ] }
```

---

## 4. Post-processing pipeline (`extraction-service.ts`) — order matters

For each item in `terms`:

1. **zod parse** (`keyTermSchema`): `term_name` non-empty string; `value` string|null; `page_number` int|null; `confidence_score` number 0–1; `source_sentence` string|null. A failing item is **dropped and counted** (`droppedTermCount` is logged, never persisted as a broken row).
2. **Confidence conversion (A-04):** `Math.round(clamp(confidence_score, 0, 1) * 100)` → integer 0–100. This is the single conversion point in the system.
3. **Page range check:** `page_number` must be an integer in `1..contract.page_count`. Out of range → `page_number = null` **and** confidence capped at **49**.
4. **Source verification:** `containsNormalised(contract_text, source_sentence)` (whitespace/quote normalisation). Result stored in `is_source_verified`. `false` or a null/empty sentence → confidence capped at **49**, honouring "a term with no supporting sentence is treated as unreliable".
5. **Not-found normalisation:** `value` null/empty/`"N/A"`/`"not found"` (case-insensitive) → `value = null`, `confidence_score = 0`.
6. **`display_rank`** from `displayRankFor(contract_type, term_name)`; custom terms get 99 and `is_custom = true`.
7. **`original_ai_value = value`** at insert. It is never overwritten, by any code path.
8. **Missing terms:** any requested term (standard or custom) absent from the model's array is inserted with `value = null`, `confidence_score = 0`, `page_number = null`, `source_sentence = null`. The panel therefore always shows the complete requested set, so the user learns what was searched for.

Capping at 49 rather than 50 is deliberate: 49 falls in the red `< 50` band, which triggers the ⚠️ warning path (FR-11).

---

## 5. Processing UI — `ProcessingSteps`

The literal three steps from PRD §4 Flow 3 step 4:
1. **Extracting text** — rendered ✓ complete immediately (it happened at upload).
2. **Analysing with AI** — active spinner **with text**; never a bare spinner.
3. **Compiling results** — active while the response is persisted/redirect is pending.

Plus a non-blocking elapsed timer and the note "this usually takes under 30 seconds". Step changes are announced in an `aria-live="polite"` region. There is no cancel control — the PRD describes an uninterrupted run. On completion the client routes to `/contracts/{id}`.

If the request fails, the step list stops at the failed step and renders the error message with the Retry CTA in place.

---

## 6. Confidence bands (single definition, used everywhere)

| Band | Range | Colour token | Icon | Text |
|---|---|---|---|---|
| high | `≥ 80` | green-600 | check | "{n}% confidence" |
| medium | `50–79` | yellow-700 | info | "{n}% confidence" |
| low | `< 50` | red-600 | ⚠️ | "{n}% confidence — verify this" |

`confidenceBand(score)` lives in `src/lib/utils/format.ts` with boundary tests at 49/50 and 79/80. Colour is **never** the only channel — icon plus text always accompany it (WCAG 2.1 AA).

---

## 7. Cost and performance envelope

~15,000 input + ~1,500 output tokens ≈ **$0.097** per 20-page analysis at $0.005/1k in + $0.015/1k out — inside the ≤ $0.20 extraction and ≤ $0.25 total ceilings, with headroom for chat turns and retries on the same contract. Every attempt's cost lands in `openai_calls.cost_usd`; a per-analysis sum exceeding $0.25 raises an alert (spec 14).

**Measured overhead — the few-shot block costs ~1,900 prompt tokens on every call.**
Verified live 2026-09-20 on a 1-page NDA: a **303-token document produced a
2,232-token prompt** and 950 completion tokens, costing **$0.025410**. The
fixed overhead is the 6 worked examples (3 NDA + 3 MSA) plus the target term
list and grounding rules, and it is paid in full on every extraction regardless
of document size — roughly **7× the document itself** on a short contract.

Consequences:
- The **$0.20 extraction ceiling is never at risk from long contracts** — at the
  15,000-token cap the overhead amortises to ~11% of the prompt (~$0.11/analysis).
  It is short contracts where cost per *page* is worst, which is the opposite of
  the intuitive risk and matters for a plan whose quota counts analyses, not pages.
- A floor of ~$0.025 applies to **every** analysis, including a 1-page NDA and
  including each retry. The 3-attempt budget therefore has a worst-case cost of
  ~$0.10 on a short document before any result is produced.
- Both halves of the few-shot block are sent for either contract type: an NDA
  extraction still pays for the 3 MSA examples. Splitting the block by
  `contract_type` would cut the overhead roughly in half and is the first lever
  to pull if the cost line needs attention — but it changes the prompt, so it
  requires a `PROMPT_VERSION` bump and a re-run of the eval set (§8, spec 17)
  to confirm the F1 gates still hold. Not done at MVP.

Latency budget: single OpenAI call ≤ 20 s P95; end-to-end upload→results ≤ 30 s P95; `first_term_ready_ms` is the millisecond delta from request start to the completed persist, and is the time-to-first-term metric.

---

## 8. Prompt versioning

Prompts are versioned modules (`extraction.v1.ts`). Any prompt change bumps the filename version **and** `PROMPT_VERSION`, which is stamped on every `contracts` row and every `openai_calls` row. At each bump the new prompt text is mirrored into the product-team prompt-library document so non-engineers can read and propose changes. The monthly A/B test compares two versions **offline** over the 50-contract eval set (spec 17) — production traffic is never split, so a user never receives an unvalidated prompt.

---

## 9. Tests

- `tests/unit/extraction-service.test.ts` — confidence conversion and clamping (0.0→0, 0.499→50 rounding, 1.0→100); out-of-range page → null + cap 49; unverified source → cap 49; not-found normalisation; missing requested term inserted at 0%; `original_ai_value` set at insert.
- `tests/unit/confidence.test.ts` — band boundaries 49/50 and 79/80.
- `tests/unit/source-verification.test.ts` — curly quotes, double spaces, line breaks and en-dashes all still verify; a genuinely absent sentence does not.
- `tests/ai/prompt-assembly.test.ts` — snapshot: 3 NDA + 3 MSA few-shot examples present; the correct 10/12 target terms for the type; custom names appended; the document body included unmodified.
- `tests/ai/json-repair.test.ts` — an invalid first response triggers exactly one repair call and then succeeds; two invalid responses yield `AI_INVALID_OUTPUT`.
- `tests/integration/process.test.ts` — happy path shape; `409 ALREADY_PROCESSING` while in flight; a `processing` row whose `processing_started_at` is 6 minutes old is re-claimed rather than rejected — **including while `GET /api/contracts/{id}` is polled every 2 s throughout**, which must not prevent reclamation — and the cron job flips such a row to `error` with `AI_TIMEOUT`; `processing_started_at` is cleared on successful completion; the 24 s deadline stops retrying and returns `504` with `status='error'`; `409 ALREADY_PROCESSED` on a completed contract; `persist_key_terms` called with another user's contract id raises and writes nothing; timeout path leaves `status='error'` with **zero** `key_terms` rows; retry after error succeeds without re-upload; rate-limit 429; semaphore-full 503; `openai_calls` and `processing_runs` rows written for every attempt.
- Evals (spec 17): extraction F1 ≥ 88% NDA / ≥ 85% MSA (beta floor 82%), page accuracy ≥ 92%, calibration error ≤ 0.10 monthly.
