# 17 — Evaluation Suite

**Sources:** PRD §10 (ground truth, eval plan, monitoring, spreadsheet schema), §3 metrics, §11 launch criteria, Assumptions 1 and 6; engineering-doc §8.2 calibration, §13 (AI/eval layer), A-15.
**Principle (A-15):** the harness and the dataset schema **ship with the code from day one**, so v0.2 has an accuracy gate even before the legal SME finishes annotating. If no SME is available it runs against the CUAD subset alone and the reduced confidence is recorded in the release report.

---

## 1. Datasets — `eval/datasets/`

| Dataset | Contents | Use |
|---|---|---|
| `cuad-subset/` | A sampled subset of CUAD (13,000+ annotations across 510 commercial contracts) | Offline baseline; the sole ground truth if no SME is available |
| `nda-labelled/` | **30** NDAs annotated by the legal SME before beta | NDA F1, page accuracy, calibration |
| `msa-labelled/` | **20** MSAs annotated by the legal SME | MSA F1, page accuracy, calibration |
| `custom-terms/` | **10 predefined custom terms** injected into **15** test contracts | Custom-term F1 |
| `chat-qa/` | **50** Q&A pairs from real contracts with expert Grounded / Hallucinated / Not-found labels | Chat groundedness |
| `hallucination/` | Contracts paired with questions about topics **absent** from them | The per-deploy hallucination regression test |
| `render-corpus/` | **50 real-world NDAs and MSAs** with unusual fonts, multi-column, rotated pages, embedded forms — **distinct from the accuracy sets** | PDF rendering compatibility (spec 18) |

Label file per contract: `{ contract_id, contract_type, jurisdiction?, industry?, terms: [{ term_name, expected_value, expected_page }] }`. `jurisdiction` and `industry` are optional and drive the monthly fairness segmentation.

---

## 2. Runners — `eval/runners/`

| Runner | Metric | Target | Cadence |
|---|---|---|---|
| `extraction-f1.ts` | Precision / Recall / **F1** against the labelled set | **≥ 88% NDA, ≥ 85% MSA**; beta floor **82%** | Every release |
| `page-accuracy.ts` | % of terms whose `page_number` matches ground truth | **≥ 92%** | Every release |
| `custom-term-f1.ts` | F1 over 10 custom terms × 15 contracts | **≥ 80%** | Every release |
| `calibration.ts` | Calibration curve, predicted confidence vs. observed accuracy in **10% buckets** | Calibration error **≤ 0.10**; a bucket within ±10% | Monthly |
| `chat-groundedness.ts` | % of 50 expert-reviewed answers labelled Hallucinated | **≤ 5%** | Monthly |
| `term-coverage.ts` | **% of standard terms returned with a non-null `value`** over the 30 NDA + 20 MSA labelled set, reported per contract type and overall | **≥ 80%** (US-002 acceptance; engineering-doc §10 v0.2 "≥ 80% of standard terms return a value on the eval set") | Every release |
| `latency.ts` | P95 upload→results and chat latency from `processing_runs` / `chat_messages` | ≤ 30 s / ≤ 15 s | Every release |
| `run-all.ts` | Orchestrates the per-release set and writes the report | — | `npm run eval` |

**Value matching** for F1: normalised string comparison (`normalise()` from spec 01 §4) plus type-aware equivalence for dates, durations ("36 months" ≡ "thirty-six (36) months") and currency amounts. A term is a true positive when the value matches **and** the ground truth had a value; a value produced where ground truth has none is a false positive; a `null` where ground truth has a value is a false negative.

All live-model runners call the **same** `extraction-service` and `chat-service` used in production, against OpenAI GPT-4o — never a mock — so an eval result is a statement about the shipped pipeline.

---

## 3. Report schema — `eval/reports/<release>.csv`

Exactly the columns the PRD's evaluation spreadsheet specifies, plus one:

```
Contract_ID | Contract_Type | Term_Name | Expected_Value | AI_Extracted_Value |
Expected_Page | AI_Page | Confidence_Score | F1_Match | Expert_Rating | Notes | Prompt_Version
```

`Prompt_Version` makes every result attributable to a prompt revision, which is what the monthly A/B test compares.

A companion `<release>.summary.json` holds the aggregates: F1 by type, **standard-term value coverage** by type, page accuracy, custom-term F1, calibration error with its bucket table, groundedness rate, latency P95s, dataset provenance (SME-annotated vs. CUAD-only) and the pass/fail verdict per gate.

---

## 4. Prompt A/B testing (PRD §8)

Monthly, two prompt versions are run over the **same 50-contract offline eval set**; F1, page accuracy and calibration are compared per version via the `Prompt_Version` stamp, and the winner becomes the new default. **No production traffic is split** — users never receive an unvalidated prompt.

---

## 5. Post-launch AI monitoring

- The automated regression suite runs on **every deploy** against the 50-contract labelled set; a red metric **blocks the deploy**.
- **Weekly drift check:** sample 10 recent user-corrected terms and compare against expected extraction.
- **Alert:** a 7-day rolling correction rate above **12%** triggers an immediate prompt review (spec 14).
- **Monthly:** the calibration run (error ≥ 0.15 flips `CALIBRATION_WARNING_ACTIVE` on, rendering `CalibrationNotice` until it clears) and a legal-SME audit of **5 random production contracts**, exported by an operator from `feedback_opt_in = true` rows only, stripped of identifiers.
- **Monthly fairness audit:** the same report rows re-aggregated **segmented by contract jurisdiction (where known) and industry**, joined with `user_feedback.contract_type`, to surface systematic gaps in underrepresented groups.

---

## 6. Deterministic AI tests (no model call — run on every PR)

Live-model evals cost money and vary; these do not, so they gate every PR:
- Term-coverage arithmetic: a fixture with 8 of 10 NDA terms valued reports exactly 80% and passes; 7 of 10 reports 70% and fails.
- Prompt-assembly snapshots: the few-shot blocks are present; the correct 10/12 target terms for the type; custom terms appended; the document omitted for `history`-class chat queries.
- JSON-repair retry fires exactly once and only on a parse failure.
- Citation-repair retry fires exactly once and only when a substantive answer lacks `[Page X]`.
- Confidence conversion, page range capping and source-verification capping (spec 06 §4).

---

## 7. Cost of running evals

A full live-model release run is ~50 extraction calls ≈ **$5** plus ~50 chat calls ≈ **$1**. Eval spend is tagged in `openai_calls` by running under a dedicated operator user id, so it can be excluded from the production cost rollup.

---

## v1.1 amendments (PRD v1.1, 2026-09-21 — §10 R-24, R-26, R-29, R-32, R-23, R-21b)

Everything about the HHH layer, the judge, red teaming, the instructor golden set, the synthetic corpus, the failure pool and the exports is specified in **spec 22**; this section records what changes in this file's own sections.

### A. Datasets (§1)

| Directory | Change |
|---|---|
| `msa-instructor/` | **Added — the primary MSA set** (dataset 1): `golden-set.json` + `pdfs/<tab>.pdf` (spec 22 §1). The eval-set F1/page/calibration runners take `--dataset msa-instructor` by default for MSA; `msa-labelled/` (SME 20) is added when available and reported separately, never merged |
| `synthetic/` | Added (dataset 3): 6 NDA + 4 MSA, provenance in `eval/datasets/README.md`, rows tagged `Dataset_Provenance=synthetic` and excluded from any "real-contract" headline number |
| `risk-labels/` | Added (dataset 5), consumed by `risk-f1.ts` (spec 20 §7) |
| `hhh-questionnaire.csv` | Byte copy of `docs/reference/hhh-questionnaire-instructor.csv` (spec 22 §2) |
| `redteam/` (`eval/redteam/attacks.json`) | Spec 22 §9 |
| Label file schema | gains `question` per term (from the golden set's `question_as_asked` or the library's `question`) and an optional `expected_reasoning_keywords[]` used only for reporting |

The MEP acceptance (`mep-acceptance.ts`, spec 22 §8) replaces "runs against CUAD alone" as the v0.2 exit criterion when the golden set is present; the CUAD-only fallback (A-15) remains for NDA.

### B. Runners (§2) — added rows

`risk-f1.ts` (SKIPPED) · `hhh-human.ts` · `hhh-judge.ts` (SKIPPED < 50 human rows) · `judge-precision.ts` (SKIPPED < 50) · `redteam.ts` · `wrong-tool-calls.ts` (always SKIPPED) · `mep-acceptance.ts` · `sample-week.ts` — all in spec 22 §12; `run-all.ts` executes every runner and emits one row each, with **`SKIPPED` never upgraded to `PASS`** (P-5). `extraction-f1.ts` gains `--dataset`, `Matcher_Version`/`Term_Library_Version` stamping, the cross-library comparison refusal and the re-baseline output (spec 22 §1), and appends every miss to `eval/failures/` (spec 22 §11).

### C. Report schema (§3)

Columns become, in the PRD §10 order followed by the three v1.1 additions: `Contract_ID | Contract_Type | Term_Name | Expected_Value | AI_Extracted_Value | Expected_Page | AI_Page | Confidence_Score | F1_Match | Expert_Rating | Prompt_Version | Notes | Matcher_Version | Term_Library_Version | Dataset_Provenance` (this supersedes §3's `Notes | Prompt_Version` order, which had the last two columns swapped relative to PRD §10). `<release>.summary.json` gains the fields listed in spec 22 §12 and a `rows[]` gate list covering every runner. Reports are also exported to `eval/export/foundry.jsonl` (spec 22 §10) and the HHH sheet (spec 22 §5).

### D. Post-launch monitoring (§5)

Adds: weekly HHH scoring — human rows by the legal SME through the sheet round-trip (spec 22 §5, §7: all 200/week while the judge gate is unmet, 20 % once met; owners may additionally score their own contracts in Review mode), the judge for the rest once gated; human-vs-judge drift on the overlap; `alert_rules`-driven thresholds (spec 23 §2); the red-team run on every deploy. The per-deploy regression suite now runs on the instructor set (MSA) + labelled NDA set.

### E. Cost (§7)

Add ≈ $5 per instructor-set run (10 extractions + summaries), ≈ $1 for the red-team set, and the judge budget (≈ $40/month at 200 samples/week, PRD §12) — all under the dedicated eval user id and `purpose='judge'` for the judge, excluded from cost per contract.

**Superseded v1.0 lines:** §6 "the correct 10/12 target terms for the type" → **10/36**, with each MSA term's verbatim question and answer format (spec 06 v1.1 §E).
