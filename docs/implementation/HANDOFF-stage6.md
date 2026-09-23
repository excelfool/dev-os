# HANDOFF — Stage 5 closed, Stage 6 (chat and retrieval) next, written 2026-09-22

**For:** whoever picks up Stage 6. Read this, then `docs/ContractIQ_PRD.md` v1.1, then the specs it names. The engineering doc is still v1.0 + `docs/engineering/delta-v1.1.md`; the specs under `docs/implementation/` carry the v1.1 amendments.

**Standing rules for the next session.** Never modify an external system — Supabase, Netlify, OpenAI — unless the student names it in the task. Never run the integration, RLS or E2E suites against the live `contractiq` project (G35 below). No `Co-Authored-By` trailers. Commit, never push.

## 1. State at HEAD

```
fcb0849 Stage 5d-3b: hydrate Review mode from saved scores (L14)
eeda29d Stage 5d-3a: Review footer count, message-contract check, Capability prop note (closes Stage 5)
e6c356d Stage 5d-3: Review mode — HHH questionnaire per term, summary and chat answer (spec 22 §2–§4)
8d76a01 Stage 5d-2c: renewal anchored on the current term end (k ≥ 0), month-end clamp
6ee32b9 Stage 5d-2b: page indicator, multi-page citations, date display, renewal roll-forward (L7–L11)
8a6f3dc Stage 5d-2a: reasoning visible in-row (spec 07 §C deviation, R-16)
8abfe88 Stage 5d-2: edit value, page and reasoning with originals kept (spec 07 v1.1 §C–§D)
fa03424 Stage 5d-1b: L6 — honour OpenAI rate-limit headers, log every failed attempt (spec 06 §3)
81e1aa4 Stage 5d-1: L5 — retry timeouts, extraction call 45 s, single retry layer (spec 06 §3/§G)
040016f Stage 5d-0: L4 — summary call budget 20 s, capped by deadline (spec 06 §B)
9829288 Handoff: Stage 5a–5c live, L4 open
1ffa6ae Stage 5c: fix background invocation (L3)
```

**Live:** everything is pushed and `contractiqlab.netlify.app` is deployed at **fcb0849**. `PROCESS_JOB_SECRET` is set in the Netlify site environment, so `POST /process` runs in async mode (202 → `process-background`).

| Commit | What it changed |
|---|---|
| 040016f | **L4 — summary call budget.** `OPENAI_SUMMARY_TIMEOUT_MS` 10 s → **20 s** (D45 sends the full contract text; 10 s was sized for the windowed design). `runSummary` never issues a call whose timeout exceeds the remaining budget: each call, first and repair, gets `min(timeout, deadlineAt − now − 1 s)`. Under 3 s left it issues no call and returns the row to `pending` — not `error` — so route 34 finishes it. Route 34 passes a 22 s deadline (Netlify sync ceiling 26 s, D36). Budgets: route 34 first call ≤ 20 s; background job the full 20 s; inline (dev/tests only) 14–19 s. |
| 81e1aa4 | **L5 — retries and the extraction timeout.** Two defects, from a live job that died `AI_TIMEOUT` at 20.6 s of a 120 s budget with no retry. (1) `isRetryable` tested `instanceof APIError` first and so classified `APIUserAbortError`, `APIConnectionError` and `APIConnectionTimeoutError` — all `status: undefined` — as non-retryable; **timeouts and connection failures were never retried, on any purpose.** The classifier now tests those first. (2) New **`OPENAI_EXTRACTION_TIMEOUT_MS` = 45 s** for extraction and its JSON repair; `OPENAI_TIMEOUT_MS` stays 20 s for chat and the enhancer. Also `maxRetries: 0` on the SDK client, so `callLlm`'s loop is the only retry layer and every attempt writes an `openai_calls` row. |
| fa03424 | **L6 — rate limits.** A 429 is now retried on the provider's clock: `retry-after-ms`, then `retry-after`, then the larger of the two `x-ratelimit-reset-*` durations, parsed by the exported `parseRateLimitDuration` ("6m0s", "1.2s", "20ms"), ±10 % jitter, capped 30 s, and only taken when `now + wait + 6 s` still fits the deadline. A 429 with code `insufficient_quota` is **not** retried (billing, not pacing). Every failed attempt logs one line: `{ llm: 'attempt_failed', purpose, attempt, name, status, code, retryAfterMs, latencyMs }` — `name` is the error **class**, which is what was missing when a summary repair failed in 379 ms and could not be classified. `openai_calls.outcome` is unchanged (`'error'` for a 429): its CHECK has no rate-limit value and the schema was deliberately not migrated. |
| 8abfe88 | **Spec 07 v1.1 §C–§D — inline editing.** `PATCH /api/key-terms/{id}` takes any non-empty subset of `{ value, page_number, reasoning }`, each field reporting its own code (`INVALID_VALUE`, `INVALID_PAGE` with the contract's own page ceiling interpolated, `INVALID_REASONING`); an empty body is `VALIDATION`. Sets only the flags for fields present, `edited_at` always, and **never** writes an `original_ai_*` column. New `WhySection`, the `PageChip` pencil, a field-aware `InlineTermEditor`, per-field "Page edited" / "Reasoning edited" tags, `term_edited.field` metadata. Also the `AI_TIMEOUT` copy fix: it now says the service took too long, not that it could not be reached. |
| 8a6f3dc | **D54 — reasoning moved in-row** (deviation from spec 07 §C, recorded there). Reasoning is one line under the value, visible without opening anything, with its Edit link and tag beside it; the "Why?" disclosure keeps only the **Source** block. PRD R-16 wants answer, citation and reasoning shown together, and reasoning behind a disclosure is reasoning most users never open. |
| 6ee32b9 | **L7–L11 — results-page fixes.** L7: the "Page X of N" indicator was driven by the lazy-render `IntersectionObserver` under a 200 % `rootMargin`, so it followed whichever entry fired last; it is now the page covering the largest visible area, remeasured on scroll and set directly on navigation, in both viewers. L8: multi-page citations (`[Page 1, 5, 7]`, `[Pages 3–4]`, `[Page 3, Page 5]`) now parse — one chip per page — and, more seriously, the validator counted them as **uncited**, asking for repairs that were not needed. L9: date-only values no longer shift a day in a negative-offset zone (`formatDateOnly`). L10: see D52. L11: "Found on page N" reads `original_ai_page`, so correcting a term's page no longer rewrites where the quote came from. |
| 8d76a01 | **D52 correction.** 5d-2b anchored the renewal series at k ≥ 1, which told a reader whose term ends next March that their notice deadline was a year later. The anchor is the **end of the current term** (k ≥ 0), plus a month-end clamp. |
| e6c356d | **Review mode (spec 22 §2–§4).** The 29 HHH codes load from the instructor CSV — `eval:sync-refs` copies it to `eval/datasets/` and parses it to JSON the browser can import; a unit test asserts byte-identity and verbatim questions. `PUT /api/hhh-scores` (route 32) writes a human row per subject: the partial unique index cannot be named in `on_conflict`, so the upsert is select-then-update-or-insert with a 23505 retry. The verdict columns are never sent — `compute_hhh_verdicts` owns them — and are read back as three pills. `HhhQuestionnaire` on each term, the summary and each assistant chat answer; `<Capability>` wrapper; D53. Also L12 (key dates sorted by the **displayed** date, upcoming first, Passed last). |
| eeda29d | **L13 + two carry-overs.** The footer's "k human rows total" was never fetched at all — the provider defaulted it to 0 and nothing set it. The page now counts server-side and route 32 returns `human_row_count` with every save. A `message` subject is verified against the contract in the body via `chat_sessions`, not just against the user. Specs 07/21/22: the `<Capability>` prop is `capability`, because React reserves `key`. |
| fcb0849 | **L14 — hydration, and the data loss behind it.** Review mode did not read back what it had saved: after a refresh every questionnaire opened blank. Because route 32 writes **every** applicable column on each save, one answer on that blank form would have written NULL across the stored answers — silently. The page now loads this reviewer's rows for the contract and seeds the context; each questionnaire opens pre-filled, a stored NULL shows as **Skip**, pills show without a save, and a save sends the **full** merged answer set. |

## 2. What was verified live, and what was not

All of Stage 5d was walked in the browser on contract **93ba9b49** (Expel.pdf, 8 pp) at fcb0849 and confirmed in the live database.

| Item | Live evidence |
|---|---|
| L4 | Summary generated **in the background job in 3.5 s** |
| L5 | Extraction **batch B took 32.7 s and succeeded on attempt 1** — it would have timed out under the old 20 s cap |
| L7 | Citation chip navigation lands on "Page 5 of 8" |
| L8 | Multi-page citations render as separate chips |
| L9 / L10 | Key dates read **Contract ends 21 Sep 2022 (Passed)**, **Auto-renewal check 21 Dec 2026**, **Renews on 21 Mar 2027** |
| L11 | Source block shows page 5 |
| L13 / L14 | Footer "Scored 2 of 36 · 2 human rows"; a save after reload kept `h1=false`, `o5=true` and added `h2=false` |

**Not confirmed live.** L7's hand-scroll behaviour is unit-tested only — the chip path is what was walked. **L12** (key-date sort order) is built and unit-tested but has not been seen in the browser. **L6** is *mitigated*, not proven: the 429 path has not fired since Tier 2 (D51), and the original 379 ms summary-repair failure was never classified. The `attempt_failed` line is what will name it next time; leave it in place.

## 3. Gates — at HEAD (fcb0849)

| Gate | Result |
|---|---|
| `npm run lint` | pass |
| `npx tsc --noEmit` | pass |
| `npm run build` | pass |
| `npx vitest run tests/unit tests/hooks` | **414 tests, 33 files, pass** |
| `vitest run tests/integration` | **not run since 1ffa6ae** |
| `npm run test:rls` | **not run since 1ffa6ae** |
| `npx playwright test` | **not run since 1ffa6ae** |

The last green integration/RLS/E2E figures are the 1ffa6ae ones (109 integration, 45 RLS, 81 E2E) and they do not cover anything in §1. Three suites have been **written and never executed**, because `.env.local` points at live `contractiq` (G35):

| Suite | Tests | Covers |
|---|---|---|
| `tests/integration/key-term-edit.test.ts` | 10 | Per-field validation on route 9, the per-field flags, and the invariant no constraint enforces — `original_ai_*` survives every edit |
| `tests/integration/hhh-scores.test.ts` | 9 | Route 32 end to end: computed verdicts, reviewer identity, update-not-duplicate, Skip clearing a column, summary with no subject id, 404 and 401 |
| `tests/rls/hhh-scores.test.ts` | 9 | `hhh_scores` RLS: `created_by` enforcement, B cannot read or write A's rows, A cannot alter an SME row on A's own contract, the judge/`scorer_role` CHECK |

That is **28 unrun tests**. Spec 21 §9's integration expectations were also *changed* (not run) by 5d-2c: the fixture ending 2027-03-31 now derives `renewal_date` = the end date itself and `renewal_notice_deadline` = 2027-03-01, and the card shows them as one "Term ends and auto-renews" row.

## 4. Supabase — `contractiq` project (ref `bumjoxthlkdvvrcollut`)

- **No schema change in Stage 5d.** Every stage was code-only; `hhh_scores` (49 columns, `compute_hhh_verdicts` + `updated_at` triggers, owner INSERT/SELECT/UPDATE RLS, the three partial unique indexes) was already present and is what Review mode writes to.
- The full v1.1 schema section was applied on 2026-09-22 (outside this repo's tasks): 28 tables, RLS on all, 4 cron jobs, 5 seeded playbook rules, 6 alert rules, 13 views.
- `reclaim-stale-processing` (every 5 min) remains the dead-job recovery for background runs. See **L15** — it writes stale copy.
- The CRM / e-sign / n8n adapters are still NullAdapters; no vendor is configured.

## 5. Decisions taken in Stage 5d

- **D51 (2026-09-22) — the OpenAI organisation moved to Usage Tier 2:** gpt-4o **450,000 TPM / 5,000 RPM** (was 30,000 / 500). One 36-term MSA run is ~34k prompt tokens, so product traffic is far below the ceiling; the Stage 7 eval runner can still send ~380k tokens in a minute, so the 429 handling of L6 is live code, not a dormant branch.
- **D52 (2026-09-22) — renewal roll-forward.** `renewal_date` is the first `end_date + k × period` with **k ≥ 0** that is not before today; `auto_renewal_check` and `renewal_notice_deadline` hang off that occurrence. Month arithmetic clamps to the last day of the target month, and every occurrence is measured from the end date so a clamp never compounds. Applied at derivation **and** on read (route 29 and the card share one pure function), so a stored date that has since passed is never shown as upcoming. Anything still past renders **"Passed"** with no reminder toggles.
- **D53 (2026-09-22) — `eval.hhh_human` is `stub`, not `built`.** Review mode saves rows today, so `planned` would hide something that works; the capability's point is an evaluation deliverable, and the sheet export that produces one is Stage 7. `stub` with `stub="children"` states exactly that.
- **D54 (2026-09-22) — reasoning is shown in the row**, not in the "Why?" disclosure (deviation from spec 07 §C, recorded there, per PRD R-16).

Earlier decisions (D45 summary input, D47 c output size, D49 a `pipeline.async`) stand unchanged — see the Stage 5a–5c handoff in git history at 9829288 for their detail, and specs 06 §B/§G.

## 6. Open items, in the order they should be taken

1. **G35 — the test suites have no project of their own.** `.env.local` points at live `contractiq`, so integration, RLS and E2E have not run since 1ffa6ae. The cost is already visible in the live data: **904 test-fixture contract rows** and **~900 orphan users**. Stage 6 adds chat tests, which will make it worse. This is **external and the student's call**: a second Supabase project for the suites, then re-point `.env.local` and run the 28 unrun tests above. Until then, unit and hook tests are the only gate that runs.
2. **G36 — `key_terms` originals are protected only by the route.** `original_ai_value`, `original_ai_page`, `original_ai_reasoning` and the edit flags have no trigger; route 9 being the only writer is the whole guarantee, and a unit test asserts the update payload carries no `original_ai_*` key. A BEFORE UPDATE trigger belongs in **Stage 8** with the other hardening.
3. **G37 — `purge-expired-pdfs` is scheduled against a placeholder.** The cron job is active in the live project with the literal `<PROJECT_REF>` in its URL and the Edge Function is undeployed, so it fails every run. **Stage 9** (deploy), together with D50.
4. **L15 — the reclaim cron writes stale copy.** `reclaim-stale-processing` sets `contracts.error_message` to the old `AI_TIMEOUT` wording ("We couldn't reach the AI service"), which 8abfe88 corrected in the app to "The AI service took too long to respond." A user reclaimed by the cron sees the old sentence. Fixing it is a **live cron change** — Stage 8/9, and only when the student names it.
5. **D50 — pin the Netlify functions runtime to Node 22.** Would remove the `ws` shim that L3 needed. Site setting, so **Stage 9**.
6. **C25 / C27 — the 20-page cap and the `MAX_TOKENS` gate.** Three instructor contracts (Stripe 35 pp, Celonis 31, Square 141) are unscorable as shipped. This is the standing argument for chunked retrieval and is **input to Stage 6**, not a separate task.

Carried from Stage 4, still open: the v2 page-accuracy drop (64 % → 53 %) is unanalysed, and the eval matcher's unit/label follow-ups (see 9829288 §5) are unstarted.

## 7. Next — Stage 6: chat and retrieval

Stage 6 is **chat and retrieval**, not the security pass the previous handoff named — the security foundation moves to Stage 8 with G36 and L15.

1. **Query enhancer** — spec 08 v1.1 §B. `retrieval.query_enhancer` goes `planned → built`. It already has its config (`OPENAI_MODEL_ENHANCER`, `OPENAI_ENHANCER_MAX_TOKENS`, `OPENAI_ENHANCER_TIMEOUT_MS`) and its purpose in `LlmPurpose`. It runs on the §B values, not `OPENAI_TIMEOUT_MS`: **`OPENAI_ENHANCER_TIMEOUT_MS` = 5 s, `OPENAI_ENHANCER_MAX_TOKENS` = 120, one attempt, never retried**, inside the 15 s chat-turn budget (G43). *(Corrected 2026-09-23: this line previously said it runs on `OPENAI_TIMEOUT_MS` (20 s).)*
2. **`RetrievalStrategy` interface** — spec 08 v1.1 §D, spec 21 §4. Full-context is the one **built** strategy; **vector**, **graph** and **n8n** are registered stubs behind it, so the capability table stays honest and the swap is an adapter change rather than a rewrite.
3. **The C25/C27 argument.** Chunked retrieval is what makes a 35- or 141-page contract reachable. Stage 6 is where that case gets made with the instructor set in hand.

**Chat-answer HHH scoring is already wired** (5d-3): each assistant bubble carries an `HhhQuestionnaire` for `subject_type='message'`, route 32 accepts it, and 5d-3a scopes it to the contract. Stage 6 does not need to build scoring — it needs to not break it, and the message subset (`APPLICABLE_CODES.message`) is what the judge will answer for the same subjects later.

Repo hygiene: `.gitignore` covers `eval/reports/.cache/` and the instructor PDFs. `npm run eval:sync-refs` must be re-run if `docs/reference/key-terms-msa-instructor.json` **or** `docs/reference/hhh-questionnaire-instructor.csv` changes — unit tests enforce byte-identity for both.

---

## 8. Stage 6 (CLAUDE.md Stage 8, Memory Layer) — done, 2026-09-23

Worked in a Docker sandbox against a **local** Supabase stack (`npm run supabase:start`, `npm run supabase:reset`); every suite now refuses a non-loopback Supabase URL (G35 closed for the suites by 49f983c). Prep commits before the chat work: 49f983c (suite guard), 6ecc383 (fixtures, harness process group, `hhh_scores` policy scope G40), ecb1c02 (frozen key-dates clock), 2f8822a (dev-only loopback CSP, G42), 0c084ac (PDF re-scroll after render, L16).

| Commit | What it did |
|---|---|
| **02693cb** | **Chat budget, citations, greeting, enhancer.** One 15 s budget per chat turn from request start, shared by the enhancer, the answer's retries and the one-attempt repair; out of budget ⇒ `504 AI_TIMEOUT` with the question kept (G43). Chat and the summary share one citation parser, `src/lib/ai/citations.ts`, so chat accepts `[Page 1, 5, 7]`, `[Pages 3–4]`, `[Page 3, Page 5]` (G44). Greeting pre-check (§A 5b): fixed reply, no classifier/enhancer/model call. Query enhancer (§B): 5 s, 120 tokens, one attempt, JSON mode; runs only without a history signal (C28); `Search focus:` after the document; `enhanced_query` on the user row; one `processing_runs` `chat` row per turn. `retrieval.query_enhancer` → built. |
| **721331f** | **Guardrails and escalation.** `src/lib/security/guardrails.ts` (spec 13 v1.1 §A): five PRD rules + injection, three entry points, one hash-only `guardrail_events` row per match. The Lab 3 injection patterns folded in under the `inj.*` ids. A blocked chat message is now a stored fixed reply, not `400 PROMPT_INJECTION`; the process route flags injected directives in the contract text. Chat prompt gained the harmless sentence (`PROMPT_VERSION` v2.1). Unresolved-turn counter (spec 20 §5.1) → `escalation_offer`, `EscalateOffer` stub note. E2E time zone pinned to UTC (G46). |
| **Checkpoint 3** (the commit that adds this section) | **RetrievalStrategy and the external RAG adapter.** `src/lib/ai/retrieval/` (full-context built and byte-identical to before; vector/graph stubs rejected at boot; n8n delegating to `src/lib/integrations/rag/`, `501 retrieval.n8n` while unconfigured). A delegated answer passes the shared citation validation and the outbound screen. The C25/C27 case written into spec 08 v1.1 §D; `run-all.ts` emits a SKIPPED row per blocked contract. "summarize" memory eval case; a 31st-chat-message `429` integration test. |

| Gap | One line |
|---|---|
| **G43** | The chat turn had no overall budget: each call had its own 20 s timeout, so enhancer + answer + retries + repair could run far past the 15 s P95. Now one deadline for the whole turn. |
| **G44** | Chat's citation regex only understood `[Page N]`; the multi-page forms the summary already parsed (L8) counted as uncited in chat and triggered needless repairs. One shared parser now. |
| **G45** | `callLlm` returned `AI_UNAVAILABLE` (503) when a caller's deadline left no room for even a first attempt; it now returns `AI_TIMEOUT` (504) — the budget ran out, the provider was never tried (spec 06 §3 note). |
| **G46** | E2E date assertions were formatted in the runner's `TZ=EDT4` while the browsers rendered in UTC, so `duplicate-upload` failed every night from 20:00 EDT. Browsers and app server now share one pinned zone. |
| **G47** | `chat_messages` is append-only (no UPDATE policy), so writing `enhanced_query` onto the user row after the enhancer failed silently. The enhancer now runs first and the user row is inserted once, with it (spec 08 §B "Order, as built"). |

**Deploy steps this stage adds (Stage 9 / CLAUDE.md deploy — none done here):**
1. **Netlify env: set `PROMPT_VERSION=v2.1`.** The code default moved to v2.1 (the chat prompt changed), but the site's env var overrides the default, so without this every row is still stamped v2.0.
2. Apply the `hhh_scores_insert_own` / `hhh_scores_update_own` policy change (G40, 6ecc383) to the live project.
3. Optional: `OPENAI_ENHANCER_TIMEOUT_MS=5000`, `OPENAI_ENHANCER_MAX_TOKENS=120` (the defaults already match). Leave `RETRIEVAL_STRATEGY` unset (`full_context`).

**Gates at the checkpoint 3 commit:** lint, `tsc`, `test:unit` (unit + `tests/ai`), `test:hooks`, integration, RLS and Playwright (Chromium + WebKit) — all run once, locally; see the commit report for counts.

## 9. Next — Stage 7 (CLAUDE.md Stage 9, Evaluation)

Run the evaluation suite against the deployed release and write `eval/reports/<release>.json`, one verdict per metric — `PASS`, `FAIL` or `SKIPPED` with a reason, never `PASS` for something unmeasured: HHH (% helpful / honest / harmful over the 29-question questionnaire), extraction F1, page accuracy, confidence calibration, red-team pass rate, judge precision (and recall) against human `hhh_scores` rows.

- **This needs live model calls** (OpenAI) and, for the deployed release, the live project — both external: only when the student names them.
- The five instructor MSAs blocked by `MAX_PAGES`/`MAX_TOKENS` (spec 08 §D note) are reported as SKIPPED rows naming `retrieval.vector`; they are not failures of the extraction prompt.
- The chat memory set now includes the "summarize" case (`mustNotRepeatPrevious`).
- In the sandbox, `npm run eval` uses `tsx`, whose bundled esbuild (0.23.1) has no linux-arm64 binary in the Mac-installed `node_modules`; add `@esbuild/linux-arm64@0.23.1` under `node_modules/tsx/node_modules/@esbuild/` first, as was done for vitest's esbuild, rollup and Next SWC.
