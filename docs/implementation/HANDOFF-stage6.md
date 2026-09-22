# HANDOFF — Stage 5a–5c live (v1.1), written 2026-09-22

**For:** whoever picks up Stage 5d and then Stage 6. Read this, then `docs/ContractIQ_PRD.md` v1.1, then the specs it names. The engineering doc is still v1.0 + `docs/engineering/delta-v1.1.md`; the specs under `docs/implementation/` carry the v1.1 amendments.

## 1. State at HEAD

```
1ffa6ae Stage 5c: fix background invocation (L3)
d09e719 Stage 5b: pipeline.async via Netlify background function
180e2d2 Stage 5a: summary defer threshold, duplicate-upload notice on prepare
e9473ec Handoff: Stage 4 closed, pipeline.async is the next blocker
170b61b Stage 4b v1.1: lean anchors and parallel batches for 36-term extraction, failure pool, full-contract summary, key-date derivation
1e975d4 Stage 4a v1.1: 36-term instructor MSA library, question-based extraction v2 with reasoning, required-term flag, OCR passthrough, eval re-baseline
25dc045 Stage 3 v1.1: capability registry, docx/OCR null adapters, import options, content hash, format error codes
ccd319b Stage 2 delta: specs 20–23, v1.1 amendments, schema v1.1 additions
```

**Live:** `contractiqlab.netlify.app` is deployed at **1ffa6ae** with `PROCESS_JOB_SECRET` set in the Netlify site environment, so `POST /process` runs in async mode (202 → `process-background`). Nothing after 1ffa6ae exists yet.

| Commit | What it changed |
|---|---|
| 180e2d2 | **Stage 5a — two live defects.** L1: the summary's citation-repair call timing out discarded a valid first draft (`AI_TIMEOUT`); repair is now best-effort — the first draft is kept with `summary_uncited=true`. Inline-claim threshold raised 11 s → **15 s** (`shouldClaimSummaryInline`); below it the row stays `pending` for route 34. L2: the D46 duplicate-upload notice was lost because the wizard `router.push`ed before rendering it; it is now persisted (sessionStorage, keyed by the new contract id) and rendered as a banner at the top of `/contracts/[id]/prepare`. Tests: threshold unit test, repair-timeout and 14 s-extraction-defers integration cases, upload duplicate_of case, duplicate-banner e2e. |
| d09e719 | **Stage 5b — `pipeline.async` built (D49 a).** Steps 6–12 extracted into `src/lib/services/process-pipeline.ts` (one implementation, two callers). `POST /process` keeps every guard and the claim, then with `PROCESS_JOB_SECRET` set posts an HMAC-signed `{contract_id,user_id,issued_at}` to `netlify/functions/process-background.ts` and returns `202 {status:'processing'}`; without it, inline as before. The function verifies the signature (`src/lib/security/process-job-signature.ts`), loads the row with the service-role client (sanctioned site 7, spec 13 §2), requires `status='processing'`, runs the pipeline under `withAnalysisSlot` with a **120 s** budget and writes the same rows. `netlify.toml` gives it the pdf worker and marks `server-only` external (guard neutralised at runtime). `ProcessingSteps` copy: "Usually under a minute; long contracts can take up to two." Registry `pipeline.async` → built; `activity_events` gains `process_enqueued`. Spec 06 v1.1 §G written in full (G.1–G.6), spec 12 row 4 and spec 13 §2 amended. Tests: signature unit tests; `process-async.test.ts` (202, signed job captured by a local invoker, function driven in-process: happy path, 401, provider 500, lost claim 409); `reclaim-cron.test.ts` (parks a 6-min-old `processing` row and watches the live pg_cron tick flip it — adds ~3–4 min to the integration gate). |
| 1ffa6ae | **Stage 5c — L3.** Live, the background function crashed on every job: Netlify runs it on **`nodejs20.x`**, which has no global `WebSocket`, and supabase-js 2.116 throws `Node.js detected but native WebSocket not found` from `createClient` — after the signature check, before any write, so rows sat in `processing` until the cron (`AI_TIMEOUT` at ~6 min; Adverity.pdf 372 s). The Next server handler supplies the global itself, which is why inline never hit it. Fix: `ws` is a direct dependency and `ensureWebSocket()` installs it as the global before the app code loads. Verified by an in-process test that deletes the global and by running the `netlify build` bundle under `node --no-experimental-websocket`. |

## 2. Gates — last results (2026-09-22, at 1ffa6ae)

| Gate | Result |
|---|---|
| `npm run typecheck` | pass |
| `npm run lint` | pass |
| `vitest run tests/unit tests/ai tests/hooks` | 18 files, 149 tests pass |
| `vitest run tests/integration` (12 files) | 109 tests pass (~10 min: `reclaim-cron.test.ts` waits for a real cron tick). Kill listeners on 3100/3200/3300 before a run. A `DELETE /api/account` case once returned a transient 401 when integration, rls and e2e ran back-to-back; it passed on rerun — Supabase auth rate limits, not code. |
| `npm run test:rls` | 45 pass |
| `npx playwright test` (chromium + webkit) | 81 pass, 3 pre-existing skips (keyboard webkit, tablet fixme). Run after integration, not alongside. |
| `netlify build --offline` | `process-background.zip` lists `process-background.cjs`, `pdf-parse/.../pdf.worker.mjs`, `server-only/*`; the bundle loads under plain Node and under `--no-experimental-websocket`. The prebuild script stamps the commit into `src/generated/build-info.ts` — `git checkout` it after a local build. |

## 3. Supabase — `contractiq` project (ref `bumjoxthlkdvvrcollut`)

- 2026-09-21 (Stage 3): two columns added by migration — `contracts.ocr_confidence`, `contracts.content_hash` + `idx_contracts_user_hash`.
- **2026-09-22: the full v1.1 schema section was applied** (outside this repo's tasks). Verified from the app at run time: `key_terms.reasoning`, `contracts.summary_*`, `key_dates`, `reminders` present. Expected shape per the schema's own verification block: **28 tables, RLS on all, 4 cron jobs, 5 seeded playbook rules, 6 alert rules, 13 views** — the same counts the file produced twice on a clean Supabase Postgres 15.8 image (idempotent, 0 errors).
- Reasoning, originals, `is_required`, `term_library_version`, summaries and key dates therefore persist for real. The CRM / e-sign / n8n adapters remain NullAdapters; no vendor is configured.
- No schema change in Stage 5. `reclaim-stale-processing` (every 5 min, `processing_started_at < now() − 5 min` → `error/AI_TIMEOUT`) is the dead-job recovery for background runs and is verified live by `reclaim-cron.test.ts`.

## 4. Decisions taken in Stages 4–5

- **D45 (2026-09-21) — summary input is the full `contract_text`** with `[PAGE N]` markers plus the persisted terms as compact JSON, not a 3,000-token window. Per-summary allowance **$0.05** (was $0.03), `max_tokens` 500, temperature 0.2, 10 s single attempt, claim-first (inline only with ≥ **15 s** left since 5a; else route 34), one **best-effort** citation repair (5a: a repair failure keeps the first draft), `summary_uncited` when still uncited. Spec 06 v1.1 §B rows updated.
- **D47 option c (2026-09-21) — output size.** (1) `extraction.v2` returns `source_anchor`: the shortest verbatim span ≤ 25 words holding the answer, stored in `key_terms.source_sentence`, verified exactly as before; anchors over 25 words are accepted and counted (53 of 252 in the last eval). (2) `POST /process` runs the standard terms as **two parallel batches by `display_rank`** (MSA 1–18 / 19–36; NDA one), **`max_tokens` 4000 per batch**, custom terms with batch 2, per-batch JSON repair, `ai_extract` = wall time of the pair, batch 1's `detected_type` wins (`extraction_type_disagreement` event on conflict), one `persist_key_terms`. (3) `pipeline.async` registered as a stub — **built in 5b, see D49 a**.
- **D49 option a (2026-09-22) — `pipeline.async` is a Netlify background function**, not a queue: the route enqueues by HTTPS to the site's own `/.netlify/functions/process-background` with an HMAC over the body (`PROCESS_JOB_SECRET`), Netlify answers 202 and runs the function with a 15-min ceiling; the job budgets 120 s. Async is switched on by the presence of the secret and off (inline) without it, so tests and local dev never need Netlify. The 5-minute reclaim was kept (not raised to 15) because 5 min > the 120 s budget. Spec 06 v1.1 §G.
- Recorded in spec 19 §P by the planner: `rule_type` uses the PRD's `presence|absence|threshold|pattern`; judge model is an OpenAI id; `TERM_LIBRARY_VERSION` is `'v1.1'` (spec 05 wanted `{ NDA, MSA: 'instructor-2026-09' }` — the instructor value is exported as `MSA_LIBRARY_SOURCE_VERSION`).

## 5. Eval findings (instructor golden set, matcher v2, `eval/reports/rebaseline-2026-09-21.json`)

| block | max_tokens | scored / failed | F1 | P | R | page acc | calib err | $/contract | P95 wall |
|---|---|---|---|---|---|---|---|---|---|
| v1 (single call, production 3000) | 3000 | 3 / 4 | 55.6% | 67.7% | 47.2% | 64.3% | 0.186 | $0.186 | — |
| v2 (single call, production 3000) | 3000 | 0 / 7 | n/a — every contract truncated | | | | | | |
| v1_max6000 (diagnostic) | 6000 | 7 / 0 | 62.6% | 66.9% | 58.9% | 63.9% | 0.266 | $0.114 | — |
| v2_max6000 (diagnostic) | 6000 | 7 / 0 | 67.5% | 71.7% | 63.9% | 54.3% | 0.194 | $0.138 | — |
| **v2 shipped (D47 c: 2 batches × 4000)** | 4000 | **7 / 0** | **66.8%** | 69.5% | 64.4% | **53.1%** | 0.243 | $0.193 | **73.4 s** |

- Three tabs are unscorable as shipped: **Stripe (35 pages), Celonis (31), Square (141)** exceed `MAX_PAGES=20`.
- Page accuracy fell from ~64% (v1) to 53% (v2): the lean anchor plus question-based prompting changes which page the model cites; not yet analysed.
- **Failure pool** `eval/failures/2026-09-21-quantity-terms.md` (five weakest terms, 35 rows): (i) model ignoring `answer_format` **0**; (ii) model wrong **3**; (iii) matcher not unit/number-aware **7** (`72` vs `72.0`, `12` vs `1 year`); (iv) benchmark label outside the term's own `answer_format` **12** ("Not Mentioned", "No", "Undue Delay" on numeric terms; Yes/No on the clause-text indemnity term); tn 12, tp 1. The matcher was deliberately not changed; the follow-ups are a unit-aware numeric rule and label normalisation, re-scored under a new `Matcher_Version`.
- Eval spend across Stage 4: ≈ $6.7, nothing written to Supabase by any eval run (runner uses a no-op telemetry client).

## 6. Open — L4: the summary's 10 s first-call timeout on long contracts

L1–L3 are closed (§1). What remains from the live runs:

**L4.** `OPENAI_SUMMARY_TIMEOUT_MS` is 10 s per call, sized for the inline path's 24 s budget. In the background job (120 s) and in route 34 (its own 26 s function, no other work) that limit is the wrong one: on long MSAs the **first** summary call itself can exceed 10 s, which persists `summary_status='error'/AI_TIMEOUT` and shows "We couldn't write a summary" even though the terms are fine and time was available. 5a only fixed the *repair* call. Proposed: a 20 s first-call timeout when the caller is the background job or route 34 (pass `timeoutMs` per caller into `runSummary` / `callLlm`, or a `summaryTimeoutMs` option keyed off the remaining budget), keeping 10 s for the inline path; add an integration case with a 15 s-delayed stub through both the job and route 34 expecting `completed`, and one through inline expecting `pending` (deferred) not `error`. Do not widen the 24 s route deadline.

Second-order items carried from Stage 4: raise `MAX_PAGES` (or chunk) for the 30–140-page contracts in the instructor set (Stripe, Celonis, Square are unscorable); investigate the v2 page-accuracy drop (64% → 53%); the matcher unit/label follow-ups (§5). The 46–73 s wall times in §5 are no longer a blocker: they now run inside the background job.

## 7. Next — Stage 5d, then Stage 6

**Stage 5d (spec 07 v1.1 + spec 22 §3–§5):**

1. **L4** above — small, do it first while the summary code is fresh.
2. **Spec 07 v1.1 inline edit of value, page and reasoning:** `WhySection` "Source" + "Reasoning" blocks; `keyTermUpdateSchema` v1.1 with `INVALID_PAGE` / `INVALID_REASONING`; `page_edited` / `reasoning_edited` flags; originals (`original_ai_page`, `original_ai_reasoning`) never modified; `term_edited.field` in the event metadata; key-date re-derivation on page edits (value edits already re-derive).
3. **Review mode entry** per spec 22 §3–§5: `ReviewModeToggle`, `HhhQuestionnaire` (29 questions), `PUT /api/hhh-scores`, sheet export/import — flips `eval.hhh_human` to built; needed for the v0.2 MEP acceptance row (≥ 50 human `hhh_scores`).

**Then Stage 6 — Security Fixes** per CLAUDE.md (`/security-foundation`): audit the whole codebase including the new surfaces from Stage 5 — the signed background invocation (secret handling, replay window, the service-role read/write in `process-job-runner.ts` scoped to `contract_id` + `user_id`), the `process_enqueued` event, and the sessionStorage duplicate notice — and produce `docs/security/security-plan.md`, `supabase/rls-policies.sql`, `src/lib/security/`. Spec 20 (risk & playbook → RiskPanel) and the judge runners follow after Stage 6, as before.

Repo hygiene: `.gitignore` covers `eval/reports/.cache/` and the instructor PDFs; `npm run eval:sync-refs` must be re-run if `docs/reference/key-terms-msa-instructor.json` changes (a unit test enforces byte-identity).
