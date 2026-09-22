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

---

## v1.1 amendments (PRD v1.1, 2026-09-21 — R-16, R-21c, US-015, §6 model requirements, agent table)

### A. Prompt: ask each term's question, constrain to its answer format, return reasoning

§2 step 3 (target term list) is rendered, for every standard term, as:

```
- {term_name}
  Question: {question}
  Answer format: {answer_format}
```

and for custom terms (zero-shot, unchanged) as `- {name}` under "Additional terms the user asked for:" with `Answer format: verbatim clause text or short summary, or N/A`. The role text gains: "For each term, answer the question exactly as a careful paralegal would, in the stated answer format. When the answer format allows `N/A`, use `N/A` only when the document does not address the term." The few-shot examples are updated so every example object carries `reasoning`.

§2 step 4 output contract becomes:

```json
{ "detected_type": "NDA" | "MSA" | "OTHER",
  "terms": [ { "term_name": "string", "value": "string|null", "page_number": 1,
               "confidence_score": 0.0, "source_sentence": "string|null",
               "reasoning": "string|null" } ] }
```

Grounding rules add: "`reasoning` is one sentence explaining why the value answers the question, referencing the clause; never legal advice." `keyTermSchema` adds `reasoning: string|null` (≤ 500 chars; longer is truncated at the last sentence boundary and counted, not dropped). §4 step 7 becomes: `original_ai_value = value`, **`original_ai_page = page_number`, `original_ai_reasoning = reasoning`** at insert; none is ever overwritten. Each persisted row also carries `term_library_version` (spec 05 v1.1 §A) and `is_required` from the library.

**Model settings (PRD §6):** `max_tokens` **3000** for extraction (36 terms + reasoning; `OPENAI_EXTRACTION_MAX_TOKENS=3000`), temperature 0.1 unchanged. Model id from `OPENAI_MODEL_EXTRACTION` (default `gpt-4o`) — `LlmCallOptions.purpose` now selects the model: `extraction` → `OPENAI_MODEL_EXTRACTION`, `chat` → `OPENAI_MODEL_CHAT`, `summary` → `OPENAI_MODEL_SUMMARY`, `query_enhancer` → `OPENAI_MODEL_ENHANCER`, `judge` → `OPENAI_MODEL_JUDGE` (spec 01 v1.1 §B). All default to `gpt-4o` except the judge (empty, spec 22 §6.1). The provider is still only OpenAI.

Cost envelope (§7) updated: ~15,000 input + up to ~2,500 output tokens ≈ **$0.11** per 36-term MSA extraction — inside ≤ $0.20. The `/process` response `terms[]` objects gain `reasoning`, `original_ai_page`, `original_ai_reasoning`, `is_required`, `page_edited`, `reasoning_edited`.

Prompt version bump: this is `extraction.v2.ts` and the shipped default is **`PROMPT_VERSION='v2.0'`** (`.env.example`, spec 01 v1.1 §B) — `extraction.v1` cannot render the 36-term library, so every v1.1 row is stamped `v2.0`. The eval re-baseline of spec 22 §1 is a **pre-deploy gate** for the v1.1 release (run once against the instructor set, old and new F1 reported side by side), not a condition on which version is the default.

### B. Contract summary (US-015, `extract.summary` — first build item) — `summary.v1.ts` and step 11a

**One additional GPT-4o call at process time** (D45, 2026-09-21: full-contract input, $0.05 allowance), after `persist_key_terms` succeeds. **Claim first, always:** `persist_key_terms` leaves `summary_status='pending'`; step 11a issues the same atomic claim the deferred route uses — `update contracts set summary_status='processing', summary_claimed_at=now() where id=$1 and summary_status='pending'` — and calls the model **only if one row was updated**; zero rows means a results-page poll (second tab, reload) already claimed it via `POST /api/contracts/{id}/summary`, and the handler skips the call. There is therefore exactly one summary call per claim, whichever path wins, and the ≤ $0.03 budget cannot be doubled by a race.

| Item | Value |
|---|---|
| Purpose / model | `purpose='summary'`, `OPENAI_MODEL_SUMMARY` (default `gpt-4o`) |
| Settings | temperature **0.2**, `max_tokens` **500**, JSON mode **off** (Markdown out), single attempt, per-call timeout **10 s** |
| Input (**D45, 2026-09-21** — full contract; supersedes the 3,000-token window) | (1) the persisted terms as compact JSON `{ term_name, value, page_number, source_sentence }`; (2) the **full `contract_text`** with `[PAGE N]` markers — the window was dropped because the recitals rarely hold the obligations the summary must cite. ≈ 10,000–17,000 input + ≤ 400 output tokens ≈ **$0.05** per summary at GPT-4o pricing; the per-summary allowance is **$0.05** (was $0.03) and is reported per call in `openai_calls`, not enforced pre-call |
| Prompt (`src/lib/ai/prompts/summary.v1.ts`) | "Write a plain-language summary of this contract for a non-lawyer in **at most 200 words**. Structure: one paragraph on what the agreement is, then a bullet list `**Obligations of {party}:**` for each party you can identify from the terms. Every sentence that states a fact from the contract must end with a `[Page X]` citation taken from the term's page or the page marker in the excerpt. Use only the terms and excerpt provided. Do not give advice." |
| Validation | Word count ≤ 220 (tolerance) else truncated at the last complete bullet; every sentence containing a digit, a party name or a term value must carry `[Page X]` with `1 ≤ X ≤ page_count` — if any factual sentence lacks one, **one** repair call ("Add a [Page X] citation to every factual sentence; change nothing else") within the remaining budget; still failing ⇒ store with `summary_status='completed'` and `summary_uncited=true` rendered with the "unverified citation" note (spec 07 v1.1 §B) |
| Persist | `contracts.summary_md`, `summary_status='completed'`, `summary_generated_ms`; `processing_runs` `stage='summary'`; `openai_calls` `purpose='summary'`; `activity_events` `summary_generated` (metadata: duration only) |
| Failure | `summary_status='error'`, `summary_error_code`; **never fails `/process`** — the terms are already committed. The results page offers "Generate summary" (retry) |

**Budget and the 24 s deadline (§3a):** the claim (and the call) is attempted only if ≥ 11 s remain in the handler's 24 s budget; otherwise the handler does not claim, `summary_status` stays `'pending'` and `activity_events` `summary_deferred` is written. `GET /api/contracts/{id}` with `summary_status='pending'` triggers the results page to call **`POST /api/contracts/{id}/summary`** (route 34, spec 12 v1.1) once — idempotent: **it first requires `contracts.status='completed'`** (`409 NOT_PROCESSED`, as chat and export do — a summary is only ever generated over persisted terms, so it can never run before or concurrently with `/process`), then claims the row with `update contracts set summary_status='processing', summary_claimed_at=now() where id=$1 and status='completed' and (summary_status in ('pending','error','none') or (summary_status='processing' and summary_claimed_at < now() - interval '2 minutes'))`; zero rows updated ⇒ `409 SUMMARY_NOT_PENDING` ("already being written or complete"); otherwise it runs the §B call and returns `200 { summary_md, summary_status }`. The same route therefore serves the deferred `pending` case, the `error` retry button and legacy `none` contracts (spec 07 v1.1 §B), and a stale `processing` claim (killed function) is re-claimable after 2 minutes. **Staleness is visible to the client:** `GET /api/contracts/{id}` returns `summary_claimed_at` and the derived `summary_claim_stale = (summary_status='processing' and summary_claimed_at < now() - interval '2 minutes')` (spec 12 v1.1 route 6), so `SummaryCard` can issue the reclaim POST (spec 07 v1.1 §B) — the summary can never sit in `processing` forever with no retry, mirroring the `reclaim-stale-processing` rule for extraction. Either way the summary adds ≤ 10 s P95 to the user's wait (PRD §5).

`ProcessingSteps` (§5) becomes the PRD's **four** steps: 1 Extracting text ✓ · 2 Analysing with AI · 3 **Summarising** · 4 Compiling results; step 3 is shown "skipped for now — summary will appear on the results page" when deferred.

`persist_key_terms` sets `summary_status='pending'` (spec 02 v1.1 §C) so the state machine is `none → pending → (processing) → completed|error`.

**Step 11c — key-date derivation (US-017, `reminders.key_dates` stub — live today):** immediately after `persist_key_terms` returns and **before** the summary claim (11a), the handler calls `reminder-service.deriveKeyDates(contractId)` (spec 21 §7.2): pure DB work on the caller's JWT (reads the four source terms, upserts `key_dates`, replaces their `reminders`), typically < 100 ms and bounded to 1 s; any error is logged as `activity_events` `key_date_unparsed`-class telemetry and **never fails the run** — the terms are already committed. This is what makes `KeyDatesCard` and route 29 populated on first view, without any edit.

**Step 11b — CRM auto-push (US-016, once `crm.*` is built):** after step 11a, `crm-push-service.pushIfConnected(contractId)` runs for each `connected` `integration_connections` row of the owner with a 3 s bound; success/failure lands in `integration_events` and a `processing_runs` row `stage='crm_push'`, the run is never failed by it, and the results page offers the manual retry (spec 21 §5 route 27). While `crm.*` is `stub` the call is a no-op (no connections can exist).

**v1.1 L4 (Stage 5d-0, 2026-09-22) — summary call budget.** The per-call timeout above is **20 s** (`OPENAI_SUMMARY_TIMEOUT_MS=20000`, was 10 s: D45 sends the full contract text and the first call timed out on long contracts). `runSummary` never issues a call whose timeout exceeds the remaining budget: each call (first and repair) gets `min(OPENAI_SUMMARY_TIMEOUT_MS, deadlineAt − now − 1 s)` when a deadline is given. With < 3 s remaining the call is skipped and the row is put back to `summary_status='pending'` (not `error`) so route 34 finishes it. Budgets per path: route 34 passes `deadlineAt = request start + 22 s` (Netlify sync ceiling 26 s, D36) ⇒ first call ≤ 20 s and the existing 6 s repair guard skips the repair when the first call consumed the budget; the background job (§G) inherits `PROCESS_JOB_BUDGET_MS` (120 s) ⇒ the full 20 s; the inline step 11a (dev/tests only, `PROCESS_JOB_SECRET` unset) keeps the ≥ 15 s claim rule and gets `min(20 s, remaining − 1 s)`, so a call cut short by the deadline is left for route 34.

### C. Required fields not found ⇒ flag for review (PRD agent table, R-33)

After §4 step 8, any term with `is_required = true` (spec 05 v1.1 §B) and `value IS NULL` is persisted as usual **and** the process response carries `required_missing: ["Parties"]`. The results page renders `ReviewNeededNotice` above the terms panel: "We couldn't find {n} required term(s): {names}. Please verify these in the document before relying on this review." The rows themselves show the standard "Not found in document" plus a "Required" pill. This is the extraction agent's second HIL trigger alongside `< 50%`.

### D. OCR confidence passthrough (`ingest.ocr` stub)

`extraction-service` reads `contracts.ocr_confidence`; when non-null it is included in the `/process` response (`ocr_confidence`) and the results page shows "Scanned document — OCR confidence {n}%" under the document panel. Nothing else changes: OCR text carries the same `[PAGE N]` markers (spec 21 §4.1).

### E. Tests added

- `tests/ai/prompt-assembly.test.ts` — every MSA term appears with its verbatim `question` and `answer_format`; NDA terms with theirs; custom terms get the default format; the few-shot examples all contain `reasoning`.
- `tests/unit/extraction-service.test.ts` — `reasoning` truncation at 500 chars; `original_ai_page`/`original_ai_reasoning` set at insert; `required_missing` lists a null required term and not a null optional one.
- `tests/integration/summary.test.ts` — a completed process yields `summary_status='completed'`, ≤ 220 words, every factual sentence cited; a stubbed summary timeout leaves the terms committed and `summary_status='error'` with a retry; a run with < 11 s remaining defers (`pending`) and `POST /summary` completes it once (second call `409`); **a `POST /summary` issued while the inline summary holds the claim returns `409 SUMMARY_NOT_PENDING` and no second `openai_calls` row appears**; if the poll claims first, the inline path skips and exactly one summary row exists; a `processing` row whose `summary_claimed_at` is 3 minutes old is returned with `summary_claim_stale=true` by `GET` and is re-claimed by `POST /summary` (`200`), while one 30 s old is not (`409`); `POST /summary` on an `uploaded`, `processing` or `error` contract returns `409 NOT_PROCESSED` and writes no `openai_calls` row; `openai_calls.purpose='summary'` and `processing_runs.stage='summary'` rows exist; summary cost ≤ $0.03 on the 20-page fixture.
- `tests/unit/summary-citations.test.ts` — the factual-sentence detector and the repair trigger.
- `tests/integration/process.test.ts` (added cases) — a processed MSA fixture has its `key_dates` (three rows for the spec 21 §9 fixture) immediately after `/process` returns (step 11c); a thrown `deriveKeyDates` does not change the `200` response or `status='completed'`.

### G. D47 option c and D49 option a — lean anchors, parallel batches, and `pipeline.async` (2026-09-21, built 2026-09-22)

**D47 c (extraction shape, unchanged).** The re-baseline of spec 22 §1 showed the v2 prompt exceeding a 3,000-token output cap on every instructor MSA (36 terms × verbatim source sentence × reasoning ≈ 4,000–6,000 tokens). (1) `extraction.v2` returns **`source_anchor`** — the shortest verbatim span (≤ 25 words) containing the answer — instead of a full sentence; the service verifies it with `containsNormalised` exactly as before and stores it in `key_terms.source_sentence` (no schema change; anchors over 25 words are accepted and counted). (2) The standard terms run as **two parallel batches by `display_rank`** (MSA 1–18 and 19–36; NDA one batch), `max_tokens` **4000 each**; custom terms ride with batch 2; each batch keeps its own JSON-repair retry and `openai_calls` rows; `processing_runs` `ai_extract` records the wall time of the pair; results merge with batch 1's `detected_type` winning (a disagreement is logged as `activity_events` `extraction_type_disagreement`), dropped counts summed, one `persist_key_terms` call.

**D49 a — `pipeline.async` is built (Stage 5b).** Two parallel 4,000-token batches plus a summary do not reliably fit a 24 s request on an 8-page instructor MSA (live 2026-09-22: `ai_extract` 18.7 s, summary deferred). The route therefore hands the run to a **Netlify background function**, which is not bound by the 26 s synchronous ceiling. The design, in full:

#### G.1 The shared pipeline

Steps 6–12 of §3 (custom terms → parallel extraction → merge → `persist_key_terms` → key dates (§7.2 of spec 21) → summary (§B) → telemetry) live in **one** module, `src/lib/services/process-pipeline.ts` (`runProcessingPipeline`), with two callers. Both write exactly the same rows: `key_terms` via the RPC, `key_dates`/`reminders`, `openai_calls` (`extraction`, `repair`, `summary`), `processing_runs` (`ai_extract`, `persist`, `summary`, `total`) and `activity_events` (`extraction_type_disagreement`, `summary_deferred`, `summary_generated`). A failure is persisted by the pipeline itself: `status='error'`, `error_code`, `error_message`, `processing_started_at=null`, plus a `processing_runs` `total`/`error` row — no partial terms survive (the RPC is one transaction).

#### G.2 `POST /api/contracts/{id}/process` (route 4)

The route keeps **every** existing guard, in this order, in both modes: session and ownership (`401`, `404`); status (`409 ALREADY_PROCESSED`; `409 ALREADY_PROCESSING` unless the claim is older than 5 minutes, in which case it is re-claimed); the `process` rate-limit bucket (`429`); the global analysis semaphore (`503 CAPACITY` after 5 s of queuing); then the **claim** — `status='processing'`, `processing_started_at=now()` — and the `process_started` event. Then:

| Mode | Condition | What happens | Response |
|---|---|---|---|
| **async** | `PROCESS_JOB_SECRET` is set | The route posts `{ contract_id, user_id, issued_at }` to `/.netlify/functions/process-background` (its own site origin from Netlify's `URL`; `PROCESS_JOB_URL` overrides it for tests), signed with `x-process-job-signature: sha256=<HMAC-SHA256(body, PROCESS_JOB_SECRET)>`. Netlify queues a background function and answers `202` at once. The route writes `activity_events` `process_enqueued` and releases its semaphore slot. If the enqueue itself fails (network, non-2xx), the claim is released as a retryable `error` (`INTERNAL`) so "Try again" works immediately instead of waiting for the reclaim. | `202 { contract_id, status: 'processing' }` |
| **inline** (fallback) | `PROCESS_JOB_SECRET` unset — local dev, the integration and E2E suites | The pipeline runs inside the request under the **24 s** deadline exactly as before D49. | `200 { …terms, summary_status, … }` (unchanged shape) |

The semaphore in async mode covers the claim and hand-off only; the background function takes its own slot for the run, so the 100-analysis cap still counts running jobs, not just requests. The results page needs no change: it already navigates on any 2xx and polls `GET /api/contracts/{id}` every 2 s until `status` leaves `processing`. `ProcessingSteps` now reads "Usually under a minute; long contracts can take up to two."

#### G.3 `netlify/functions/process-background.ts`

A Netlify **background function** (the `-background` suffix is what makes Netlify queue it and return `202`; ceiling 15 minutes). Its body is `runProcessJob` in `src/lib/services/process-job-runner.ts` so the integration suite can drive it in-process:

1. **Verify** the signature over the raw body with `PROCESS_JOB_SECRET` (constant-time compare); refuse a missing/bad signature (`401`), a malformed payload (`401 malformed`), or a job older than 10 minutes (`401 expired`). Nothing is read from the database before this step. `503` if the secret is not configured.
2. **Load** the contract with the **service-role client** (the job carries no user session — sanctioned call site (7) in spec 13 §2), scoped to `id` **and** `user_id` from the payload (`404` otherwise). The row must still be `processing` (`409` otherwise): a row that is `error`/`completed`/`uploaded` means the claim was lost — reclaimed by the cron, retried inline, or deleted — and the job is stale.
3. **Run** `runProcessingPipeline` inside `withAnalysisSlot` with a **120 s** internal budget (`PROCESS_JOB_BUDGET_MS`), `startedAt` = job start (so `first_term_ready_ms` and `total` measure the job, not the request). Same rows as G.1. The summary's inline-claim rule (§B, ≥ 15 s remaining) is evaluated against this budget, so in practice the summary always runs in the job and `summary_deferred` is rare.
4. **Persist** any failure the pipeline did not already persist (e.g. `CAPACITY` from the semaphore) the same way, and return `200 { status:'completed' }` / `500 { status:'error', code }` — Netlify discards the response; it exists for the in-process tests and the function log.

**Bundling.** The function is packaged by Netlify's esbuild from `netlify/functions/`, outside the Next.js build, so `[functions."process-background"]` in `netlify.toml` repeats the server handler's `included_files` (the pdf-parse worker) and marks `server-only` external: that package throws when imported outside a React Server environment by design, so the function pre-seeds the require cache with an empty module before dynamically importing the app code. Verified with `netlify build`: the zip lists `netlify/functions/process-background.cjs`, `node_modules/pdf-parse/dist/pdf-parse/cjs/pdf.worker.mjs` and `node_modules/server-only/*`, and loads under plain Node.

**Runtime (L3, 2026-09-22).** Netlify runs the function on `nodejs20.x` (deploy manifest `"r": "nodejs20.x"`), which has no global `WebSocket`; `@supabase/supabase-js` ≥ 2.116 throws `Node.js detected but native WebSocket not found` from `createClient`. Live, the job died in `createAdminSupabaseClient` **after** the signature check and **before** any write — no `openai_calls`, no `processing_runs`, the row stayed `processing` and the reclaim cron flipped it to `AI_TIMEOUT` at ~6 min (Adverity.pdf, 372 s). The Next.js server handler supplies that global itself, so the inline route never saw it. The function now installs `ws` as `globalThis.WebSocket` (`ensureWebSocket`) before loading the app code; `ws` is a direct dependency so the bundle always carries it. Verified two ways: the in-process test deletes the global and completes a job, and the `netlify build` bundle run under `node --no-experimental-websocket` reaches the database instead of throwing. Raising the functions runtime to Node 22 would also fix it, but that is a site setting outside this repo and would change the server handler's runtime too.

#### G.4 Dead-job recovery

Three layers, none new, all documented here because the background run is the case they exist for:

| Layer | Trigger | Effect |
|---|---|---|
| `reclaim-stale-processing` pg_cron job (`supabase/database.sql`, every 5 minutes) | `status='processing'` and `processing_started_at < now() − 5 min` | `status='error'`, `error_code='AI_TIMEOUT'`, retryable message. This is **the** recovery for a background function that died (Netlify kill, crash, lost invocation): 5 min > the 120 s budget, so a healthy job can never be reclaimed under it. Verified by `tests/integration/reclaim-cron.test.ts`, which parks a 6-minute-old `processing` row and watches the next tick flip it. |
| Route 4's own stale rule | a `POST /process` on a `processing` row older than 5 min | Re-claims instead of `409` — the user's "Try again" works even between cron ticks. |
| `acquire_analysis_slot` staleness | a slot held > 2 min | Self-heals the semaphore if the function died holding a slot. |

`processing_started_at` — never `updated_at`, which the 2 s poll bumps — is the only clock these rules read. The route's 5-minute rule and the cron are deliberately the same number.

#### G.5 Configuration and registry

| Variable | Where | Meaning |
|---|---|---|
| `PROCESS_JOB_SECRET` | Netlify (server only; **the one variable that turns async on**) | HMAC key shared by the route and the function. Unset ⇒ inline fallback. |
| `PROCESS_JOB_URL` | tests only | Overrides the function URL (the harness points it at a local invoker that answers 202). |
| `PROCESS_JOB_BUDGET_MS` | optional, default 120000 | The function's internal deadline. |

Capability `pipeline.async` → **built** (spec 21 §1; `CapabilityTable` copy: "Long contracts are processed in the background; the results page updates when they finish."). `activity_events` gains `process_enqueued` (spec 14).

#### G.6 Tests

- `tests/unit/process-job-signature.test.ts` — sign/verify round trip; missing, tampered and wrong-secret signatures; malformed payload; the 10-minute replay window.
- `tests/integration/process-async.test.ts` — app started with `PROCESS_JOB_SECRET` and `PROCESS_JOB_URL` → a local invoker: `POST /process` returns `202 { status:'processing' }`, claims the row, makes no model call, enqueues one job whose signature verifies, writes `process_started` + `process_enqueued`; a second POST is `409 ALREADY_PROCESSING`; a completed contract is `409 ALREADY_PROCESSED` with nothing enqueued. The background function driven in-process with the captured job: happy path against the OpenAI stub (10 `key_terms`, summary completed, `openai_calls` `extraction`+`summary`, `processing_runs` `ai_extract`/`persist`/`summary`/`total` all `success`, `GET` shows `completed`); bad/absent signature → `401`, row untouched; provider `500` → `status='error'`/`AI_UNAVAILABLE`, no terms; a job whose row is no longer `processing` → `409`.
- `tests/integration/process.test.ts` (unchanged) is the **inline** contract: with no secret the route returns `200` with the terms.
- `tests/integration/reclaim-cron.test.ts` — the cron flips a 6-minute-old `processing` row to `error`/`AI_TIMEOUT`.

### F. Superseded v1.0 lines (read the v1.1 value)

| v1.0 text | v1.1 value |
|---|---|
| §3 step 7 `max_tokens` **2000** | **3000** (§A) |
| §5 "The literal three steps" | four steps (§B) |
| §9 `prompt-assembly.test.ts` "the correct 10/12 target terms" | the correct **10/36** target terms, each with its question and answer format (§E) |
