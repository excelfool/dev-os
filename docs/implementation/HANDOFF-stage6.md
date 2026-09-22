# HANDOFF — Stage 4 closed (v1.1), written 2026-09-22

**For:** whoever picks up Stage 5. Read this, then `docs/ContractIQ_PRD.md` v1.1, then the specs it names. The engineering doc is still v1.0 + `docs/engineering/delta-v1.1.md`; the specs under `docs/implementation/` carry the v1.1 amendments.

## 1. State at HEAD

```
170b61b Stage 4b v1.1: lean anchors and parallel batches for 36-term extraction, failure pool, full-contract summary, key-date derivation
1e975d4 Stage 4a v1.1: 36-term instructor MSA library, question-based extraction v2 with reasoning, required-term flag, OCR passthrough, eval re-baseline
25dc045 Stage 3 v1.1: capability registry, docx/OCR null adapters, import options, content hash, format error codes
ccd319b Stage 2 delta: specs 20–23, v1.1 amendments, schema v1.1 additions
c61fd23 Engineering delta vs PRD v1.1; US-015 status wording
a4909e7 CLAUDE.md: five skills, single Stage 1 output, add Stage 9 Evaluation
825908c PRD v1.1: align to instructor PRD and lecture material; file reference inputs and MSA golden set
```

Base: `67069ca` (deployed v1.0 state). Nothing above has been pushed or deployed.

| Commit | What it changed |
|---|---|
| 825908c | PRD → v1.1 (R-1…R-34 applied); instructor PRD, key-term JSON, HHH questionnaire and recommendation filed under `docs/reference/`; instructor MSA golden set under `nextjs-app/eval/datasets/msa-instructor/`. |
| a4909e7 | CLAUDE.md: "five skills", Stage 1 outputs only `engineering-doc.md`, Stage 9 — Evaluation added. |
| c61fd23 | `docs/engineering/delta-v1.1.md`: engineering-reviewer delta audit (65 COVERED / 49 PARTIAL / 115 MISSING), grouped by placeholder class; US-015 status wording fixed in the PRD. |
| ccd319b | Stage 2 delta: new specs 20–23, `## v1.1 amendments` on every spec, `supabase-schema.sql` v1.1 section (14 new tables, 13 columns, functions, 11 KPI views); reviewer APPROVED round 8. |
| 25dc045 | Stage 3: `src/lib/capabilities.ts` registry + `GET /api/capabilities` + `/settings` table; docx/OCR NullAdapters; `UNSUPPORTED_FORMAT` / `OCR_LOW_CONFIDENCE` / `NOT_IMPLEMENTED`; `ImportSourceOptions`; D46 content-hash duplicate notice. |
| 1e975d4 | Stage 4a: 36-term instructor MSA library (`TERM_LIBRARY_VERSION='v1.1'`), `extraction.v2` (question + answer format + reasoning), required-term flag, OCR passthrough, per-purpose model ids, ESLint flat config, eval re-baseline runner + report. |
| 170b61b | Stage 4b: D47 c (lean `source_anchor`, two parallel batches, `pipeline.async` stub), `--explain` failure pool, D45 full-contract summary (route 34, `SummaryCard`), key-date derivation + routes 29/30 + `KeyDatesCard`, four-step `ProcessingSteps`. |

## 2. Gates — last results (2026-09-22, at 170b61b)

| Gate | Result |
|---|---|
| `npm run typecheck` | pass |
| `npm run lint` (`eslint .`, flat config; two React-Compiler-era rules off for Next 14) | pass |
| `vitest run tests/unit tests/ai` | 15 files, 138 tests pass |
| `vitest run tests/integration` (9 files) | 98 tests pass. Note: a `next dev` orphaned by a killed loop on port 3100 once produced spurious 503s — kill listeners on 3100/3200/3300 before a run. |
| `npm run test:rls` | 45 pass |
| `npx playwright test` (chromium + webkit) | 79 pass, 3 pre-existing tablet skips. Supabase's sign-up rate limit trips when integration and e2e run together; run them sequentially. |
| `npm run eval -- --dataset msa-instructor --prompt v2` | 7/7 scored, 0 truncations (see §5) |

## 3. Supabase — `contractiq` project (ref `bumjoxthlkdvvrcollut`)

- 2026-09-21 (Stage 3): two columns added by migration — `contracts.ocr_confidence`, `contracts.content_hash` + `idx_contracts_user_hash`.
- **2026-09-22: the full v1.1 schema section was applied** (outside this repo's tasks). Verified from the app at run time: `key_terms.reasoning`, `contracts.summary_*`, `key_dates`, `reminders` present. Expected shape per the schema's own verification block: **28 tables, RLS on all, 4 cron jobs, 5 seeded playbook rules, 6 alert rules, 13 views** — the same counts the file produced twice on a clean Supabase Postgres 15.8 image (idempotent, 0 errors).
- Reasoning, originals, `is_required`, `term_library_version`, summaries and key dates therefore persist for real. The CRM / e-sign / n8n adapters remain NullAdapters; no vendor is configured.

## 4. Decisions taken in Stage 4

- **D45 (2026-09-21) — summary input is the full `contract_text`** with `[PAGE N]` markers plus the persisted terms as compact JSON, not a 3,000-token window. Per-summary allowance **$0.05** (was $0.03), `max_tokens` 500, temperature 0.2, 10 s single attempt, claim-first (inline only with ≥ 11 s left; else route 34), one citation repair, `summary_uncited` when still uncited. Spec 06 v1.1 §B rows updated.
- **D47 option c (2026-09-21) — output size.** (1) `extraction.v2` returns `source_anchor`: the shortest verbatim span ≤ 25 words holding the answer, stored in `key_terms.source_sentence`, verified exactly as before; anchors over 25 words are accepted and counted (53 of 252 in the last eval). (2) `POST /process` runs the standard terms as **two parallel batches by `display_rank`** (MSA 1–18 / 19–36; NDA one), **`max_tokens` 4000 per batch**, custom terms with batch 2, per-batch JSON repair, `ai_extract` = wall time of the pair, batch 1's `detected_type` wins (`extraction_type_disagreement` event on conflict), one `persist_key_terms`. (3) `pipeline.async` registered as a stub (phase v2, PRD §5) — design in spec 06 v1.1 §G.
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

## 6. Open blocker — the 24 s deadline

With batching, no batch truncates, but **5 of 7 instructor MSAs took 46–73 s wall** (Expel 14.7 s, PaaS 22.4 s, Armorblox 46.6 s, Adverity 59.2 s, Lumen 62.5 s, Intuit 72.2 s, Salesforce 73.4 s) against `POST /process`'s 24 s budget and the 20 s per-attempt timeout. On Netlify those runs will time out and retry. **`pipeline.async` (stub) must be built before v2 is safe on real 36-term MSAs**: Netlify background function (`process-background`, 15-minute ceiling) enqueued by the route when the estimate exceeds the budget; the results page already polls; `status='processing'` + `processing_started_at` carry the hand-off; the stale reclaim becomes 15 min for background runs (spec 06 v1.1 §G). Until then, real MSAs will mostly land in `error` with `AI_TIMEOUT` and the user's "Try again" CTA.

Second-order items: raise `MAX_PAGES` (or chunk) for the 30–140-page contracts the instructor set contains; investigate the page-accuracy drop; the matcher/label follow-ups above.

## 7. Next stage — Stage 5

In order:

1. **`pipeline.async`** (§6) — first, because it gates every real MSA.
2. **Spec 07 v1.1:** `WhySection` "Source" + "Reasoning" blocks; **inline edit of value, page and reasoning** (`keyTermUpdateSchema` v1.1, `INVALID_PAGE` / `INVALID_REASONING`, `page_edited` / `reasoning_edited`, originals never modified, `term_edited.field`); key-date re-derivation on page edits is already wired for value edits.
3. **Review mode entry** per spec 22 §3–§5 (`ReviewModeToggle`, `HhhQuestionnaire`, `PUT /api/hhh-scores`, sheet export/import) — flips `eval.hhh_human` to built; needed for the v0.2 MEP acceptance row (≥ 50 human `hhh_scores`).
4. Then spec 20 (risk & playbook stubs → RiskPanel with the seeded playbook) and the judge runners.

Repo hygiene: `.gitignore` covers `eval/reports/.cache/` and the instructor PDFs; `npm run eval:sync-refs` must be re-run if `docs/reference/key-terms-msa-instructor.json` changes (a unit test enforces byte-identity).
