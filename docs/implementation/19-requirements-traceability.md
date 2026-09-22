# 19 — Requirements Traceability

Every requirement extracted from `docs/ContractIQ_PRD.md` and `docs/engineering/engineering-doc.md`, with the spec location that makes it buildable. This is the coverage checklist used for self-review: no row is marked covered without pointing at specific text.

Legend: **MVP** = v0.1–v1.0. **v1.1/v1.2** = specified, not built at MVP (spec 15).

---

## A. User stories (PRD §4)

| ID | Requirement | Where specified |
|---|---|---|
| US-001 | Sign up / sign in / sign out; ≤ 10 s; redirect to dashboard; clear error on invalid credentials | 03 §§1–9, §12 (timing evidence), §13 |
| US-002 | Upload a PDF and see key terms extracted; ≤ 10 MB; ≤ 30 s P95; ≥ 80% of standard terms valued | 04 (whole), 06 §3; the ≥ 80% coverage criterion is measured by `term-coverage.ts` (17 §2) and gated in 18 §4 |
| US-003 | Page number per term; clicking it scrolls the viewer | 06 §4.3, 07 §3, 07 §4 (`PageChip`) |
| US-004 | Confidence 0–100% per term; `< 50` shows warning icon + tooltip | 06 §6, 07 §4 (`ConfidenceBadge`) |
| US-005 | Add custom terms before processing; same result structure | 05 §§2–5 |
| US-006 | Inline PDF viewer: all pages, scroll, zoom, clickable highlights | 07 §2 (`PdfViewer`) |
| US-007 | Chat in plain English; ≤ 15 s; grounded; page cited | 08 (whole) |
| US-008 | Dashboard shows name, type, date, status; rows open results | 09 §§1–3 |
| US-009 | Inline term edit; ≤ 2 s; "Edited" badge; original AI value stored separately | 07 §5 |
| US-010 | 👍/👎 + optional comment on the results page → `user_feedback` | 10 §2 |
| US-011 | Export key terms as CSV or PDF within 5 s (P2, v1.1) | 15 §1 |
| US-011-partial | Key terms panel with value display (P0, v0.2) — distinct from export (A-08) | 07 §4, 15 intro |
| US-012 | Chat history persists; reopening loads the previous session | 08 §2, 02 §2 (`UNIQUE (contract_id)`) |

## B. Functional requirements (PRD §4)

| ID | Requirement | Where |
|---|---|---|
| FR-01 | Supabase Auth email/password; session persists | 03 §1, §3 |
| FR-02 | Accept ≤ 10 MB / ≤ 20 pages; reject outside with a clear error | 04 §2 steps 5–7, 01 §2 (copy) |
| FR-03 | Extract text at upload into `contracts.contract_text`; reuse without re-downloading the PDF | 04 §3, 06 §3 step 6, 08 §5 |
| FR-04 | Panel shows Term Name, Value, Page, Confidence % | 07 §4 |
| FR-05 | ≥ 5 custom terms, same structure, `is_manual = true` | 05 §§1–5, 02 §3 (trigger) |
| FR-06 | Results always display content: PDF viewer or paginated text fallback; both honour `targetPage` | 07 §2, §3 |
| FR-07 | Clicking a page reference scrolls the viewer with a highlight | 07 §3 |
| FR-08 | Chat sends question + full contract text; grounded response | 08 §5 |
| FR-09 | All chat messages saved with role and timestamp | 08 §3 step 10, 02 §2 |
| FR-10 | Dashboard totals, NDA/MSA breakdown, sortable list | 09 §§1–3 |
| FR-11 | `< 50%` shows a visual warning and recommends manual verification; **never hidden** | 07 §4, 06 §6, 16 §6 |
| FR-12 | Thumbs up/down + optional comment per review | 10 §2 |
| FR-13 | All data in a single Supabase project with RLS; `user_id` FK on every table | 02 §§2, 5 |
| FR-14 | Complete DB setup — tables, indexes, triggers, RLS, Storage bucket + policies — as one paste-and-run SQL file | `supabase-schema.sql`, 02 §§1, 6 |

## C. User flows (PRD §4, eng-doc §4)

| Flow | Where |
|---|---|
| Flow 1 — visitor → sign up → empty dashboard | 03 §4, §6; 09 §2 (`EmptyState`) |
| Flow 2 — returning user → dashboard summary + quick action | 03 §7, 09 §§1–2 |
| Flow 3 — type select → upload → preview → custom terms → process → results → correction → chat → complete | 04, 05, 06, 07, 08, 10 §1 |
| Flow 4 — chat with contract, citation chips, persisted conversation | 08 |
| Flow 5 — deletion, nightly retention, account erasure | 11 |

## D. Agent capabilities (PRD §4 table)

| Component | Where |
|---|---|
| PDF Text Extractor — `[PAGE N]`, `< 100` words ⇒ "Scanned PDFs are not supported yet", extraction once at upload | 04 §§2–3 |
| Key Term Extractor — JSON `{term_name, value, page_number, confidence_score, source_sentence}`; `< 50` flagged | 06 §§2–4 |
| Confidence Evaluator — 0–100, always shown, no threshold blocks display | 06 §§4, 6; 07 §4 |
| Contract Chat Agent — answer + page citation; suggests only, takes no action | 08 §§5, 7 |
| Feedback Logger — fully autonomous write | 10 §2 |

## E. Constraints (PRD §5)

| Constraint | Where |
|---|---|
| E2E extraction ≤ 30 s P95; time-to-first-term ≤ 30 s P95 | 06 §7, 14 §3 |
| Chat ≤ 15 s P95; single OpenAI call ≤ 20 s P95 | 08 §3, 06 §1, 14 §3 |
| Inline edit ≤ 2 s; export ≤ 5 s; auth ≤ 10 s | 07 §5, 15 §1, 03 §12 |
| 10 MB / 20 pages; ≤ 15,000 tokens (independent gates, A-09) | 04 §2 step 7 |
| Text-layer only; scanned fails gracefully at `< 100` words | 04 §2, 01 §2 |
| NDA + MSA, English, US/UK only | 05 §1, 16 §6 (limitations copy) |
| ≤ 5 custom terms | 05 §3, 02 §3 |
| ≤ $0.25 per analysis (≤ $0.20 extraction) | 06 §7, 14 §§3–4 |
| 100 concurrent analyses; scale to 1,000 users | 13 §6, 18 §1 (k6) |
| 99.5% uptime; OpenAI errors surfaced with retry, no silent failures | 14 §1, 06 §3, 01 §2 |
| PDFs in Storage with 1-hour signed URLs; Storage non-blocking | 07 §6, 04 §2 step 9 |
| AES-256 at rest, TLS 1.3 in transit, RLS on all tables | 13 §9, 02 §5 |
| Usable without training; jargon tooltipped; WCAG 2.1 AA | 16 §4, 05 §1 (tooltips) |
| 90-day PDF retention post last access; manual deletion any time | 11 §§1–2 |
| GDPR: erasure on request, DPA, no third-party training, `user` parameter | 11 §3, 06 §1, 03 §5 |

## F. Technical requirements and AI architecture (PRD §6–§9, eng-doc §5–§8)

| Item | Where |
|---|---|
| Next.js 14 App Router + TypeScript strict (A-01) | 00 §§2, 6 |
| Route Handlers (Node runtime) on Netlify for **all** request/response APIs; Supabase Edge Functions **only for scheduled/background jobs**, which at MVP are `purge-expired-pdfs` (scheduled) and `send-notification` (background) (A-02) | 00 §2, 11 §2, 12 intro, 14 §2a |
| Tailwind + shadcn/ui + TanStack Query + zod + react-hook-form + pdfjs-dist | 00 §4, 01 §7, 16 §§1–2 |
| GPT-4o; ≥ 128k context; JSON mode; temp 0.1 / 0.4; max_tokens 2000 / 1000; `user` param; 20 s timeout; 3 retries | 06 §1, 08 §3 |
| Supabase Auth + Postgres + Storage; Realtime **not used** (A-07) | 02, 03 §1, 08 intro |
| Grounding: single source of truth, `source_sentence`, 1-indexed page, full-context chat, "not found" is valid | 06 §4, 08 §§5–6 |
| Prompt strategy: few-shot 3 NDA + 3 MSA, embedded confidence, zero-shot custom terms, JSON-repair retry | 06 §2, §3 step 8 |
| Prompt library versioning, `PROMPT_VERSION` stamping, monthly offline A/B | 06 §8, 17 §4 |
| Hallucination guardrails — extraction, chat and UI layers | 06 §§4, 6; 07 §§1, 4; 08 §7 |
| Provider fallback interface with no fallback wired at MVP | 06 §1 |
| Term library as a MOAT asset, extensible to 20–30 terms (A-11) | 05 §1 |

## G. Evaluation and production readiness (PRD §10–§11)

| Item | Where |
|---|---|
| Ground truth: CUAD, 30 NDA, 20 MSA, user corrections | 17 §1 |
| F1, page accuracy, custom-term F1, calibration, groundedness, latency, satisfaction | 17 §2 |
| Evaluation spreadsheet column schema (+ `Prompt_Version`) | 17 §3 |
| Post-launch monitoring: per-deploy regression, weekly drift, 12% alert, monthly SME audit | 17 §5, 14 §4 |
| HHH: top 10–12 terms by default, non-dismissible warnings, calibration notice, disclaimer | 07 §§1, 4; 16 §6 |
| Launch criteria for Alpha / Beta / Public Launch | 18 §4 |
| Responsible AI — accountability, transparency, fairness, reliability, incident comms | 16 §6, 11 §4, 14 §2, 17 §5 |

## H. Pricing and plans (PRD §12, A-06, A-16)

| Item | Where |
|---|---|
| Four plans with analysis quotas; free trial 5 in 14 days | 13 §5 |
| **No payment provider at MVP**; operator-set plans | 13 §5, 03 §11, 15 §4 |
| Export on Free Trial, Growth, Pro; withheld from Starter post-trial | 15 §1 |

## I. Assumptions (PRD §13)

| # | Handling |
|---|---|
| 1 | GPT-4o F1 — eval gate with an 82% beta floor and visible confidence scores (17 §2, 18 §4) |
| 2 | English, US/UK — scope copy and term library (16 §6, 05 §1) |
| 3 | Text-layer PDFs — `SCANNED_PDF` at `< 100` words; OCR is v1.2 (04 §2, 15 §3) |
| 4 | Supabase free tier for dev; Pro before beta | 02 §§1, 7; 18 §4 |
| 5 | ≤ 20 pages / ≤ 15,000 tokens with distinct messages | 04 §2 |
| 6 | Legal SME may be unavailable → CUAD-only runs, recorded in the report (A-15) | 17 §1, §3 |
| 7 | 14-week team capacity — the release → week-range → spec mapping and the two-engineer parallel split | 00 §9 |
| 8 | OpenAI pricing ±30% — cost config + budget alert | 01 §1, 14 §4 |
| 9 | RLS isolates users — treated as unproven until the cross-account suite passes | 02 §8, 13 §1 |
| — | "No partial key_terms rows" — implemented by the `persist_key_terms` SQL function, since PostgREST has no transaction API | 02 §3, 06 §3 step 11 |
| — | "No silent failures" for a killed `/process` function — 24 s in-handler deadline plus the 5-minute `reclaim-stale-processing` job, so a contract can never stick in `processing` | 06 §3a, 14 §4, `supabase-schema.sql` §17 |
| — | Analysis quota survives contract deletion (PRD §12 caps vs. PRD §5 delete-anytime) — monotonic `profiles.analyses_used` counter | 13 §5, 04 §2 step 7b, 02 §3 |
| — | Measurement Beta low-confidence invariant — the nightly production job that evidences gate part (a) | 14 §4, 18 §4, 07 §8 |
| — | `activity_events.event_type` closed vocabulary with a named write-site per value | 14 §3 |
| — | Quota allowance resets on an operator plan change, so trial usage never eats into the first paid month | 13 §5, 02 §3 (`on_plan_change_reset_quota`) |
| — | Stuck-run detection keyed on `processing_started_at`, immune to the results page's 2-second poll | 06 §3a, 02 §2, 07 §1 |
| 10 | Browser-based PDF viewing | 07 §2 |
| 11 | Full contract text per turn, no chunking | 08 §5 |
| 12 | Pricing directional — one config map | 13 §5, 15 §1 |
| 13 | Storage bucket + 3 policies created via SQL; omission degrades to the text viewer | 02 §6, 04 §2 step 9 |
| 14 | Full conversation history (≤ 200, ascending) + local query classification | 08 §§4–5 |

## J2. Source-internal conflicts resolved by these specs (beyond Appendix A)

| Conflict | Resolution | Where |
|---|---|---|
| Engineering-doc §9.15/§4.5 say `DELETE /api/account` "deletes the profile row", while §7.1 says `profiles` has "no client INSERT or DELETE — delete via cascade" | No direct `profiles` DELETE is issued; erasure runs through the service-role `deleteUser` and the `auth.users → profiles` cascade. A caller-JWT delete would affect zero rows and silently look like success | 11 §3 steps 3–4, 12 §15, 02 §5 |
| Engineering-doc §6.2/A-13 describe an "advisory-lock semaphore", which cannot work over Supabase's connection pool | `analysis_slots` + `FOR UPDATE SKIP LOCKED` with a 2-minute staleness reclaim | 13 §6, 02 §2, `supabase-schema.sql` §12b |
| Engineering-doc §4.3 requires a "transactional INSERT" that PostgREST cannot express | The `persist_key_terms` SQL function | 06 §3 step 11, `supabase-schema.sql` §12c |
| Engineering-doc §5.2/§4.1 give the callback URL as `/auth/callback`, while §11's folder tree shows `(auth)/callback/route.ts`, which in the App Router resolves to `/callback` (a route group adds no path segment) | The **URL wins**: the file lives at `src/app/(auth)/auth/callback/route.ts` so it serves `/auth/callback`, matching the Supabase redirect allow-list and the A-05 email-confirmation path | 00 §5, 03 §§1, 2, 8, 13 |

## J. Engineering-doc Appendix A resolutions

A-01 (00 §2) · A-02 (00 §2, 11 §2, 14 §2a) · A-03 (08 §5) · A-04 (06 §4 step 2) · A-05 (03 §1) · A-06 (13 §5) · A-07 (08 intro) · A-08 (15 intro) · A-09 (04 §2) · A-10 (11 §2) · A-11 (05 §1, 07 §4) · A-12 (07 §5, 10 §4) · A-13 (13 §6) · A-14 (06 §3 step 10, 07 §1) · A-15 (17 §1) · A-16 (15 §1).

## K. Engineering-doc §7 schema objects

All 13 documented tables plus `analysis_slots` (the concurrency semaphore backing A-13, spec 02 §2), the `term_corrections` view, every index, both `updated_at` and domain triggers, the Storage bucket and its three policies: `supabase-schema.sql`, explained in 02 §§2–6, with the volume model in 02 §7.

## L. Engineering-doc §9 API routes

All 18 routes: 12 (index + contract per route), with behaviour in the owning feature spec.

## M. Engineering-doc §10 phased features and the PRD §3 roadmap

Release-by-release weeks, scope, specs and role split: **00 §9**. Per-release detail:

v0.1 (02, 03, 09 §2) · v0.2 (04, 06, 07 §4) · v0.3 (05, 07 §§2–4) · v0.4 (08, 09, 07 §5, 01 §2) · v1.0 (10, 13 §9, 14, 16 §§4–5, 11, 18 §4) · v1.1 and v1.2 (15).

## N. Engineering-doc §11–§13

Folder structure (00 §5) · naming conventions (00 §7) · testing strategy, CI pipeline and coverage targets (18 §§1–3) · eval dataset and report schema (17 §§1, 3).

## O. Engineering-doc §16 non-functional traceability

Every row of Appendix B maps to: latency and timing (14 §3), upload limits (04 §2), custom-term cap (05 §3), cost (06 §7, 14 §4), concurrency (13 §6), uptime (14 §1), no-silent-failures (01 §2), signed URLs (07 §6), encryption (13 §9), RLS (02 §§5, 8), retention (11), GDPR (11 §3), accessibility (16 §4), correction rate (10 §5), hallucination (08 §7, 17 §2), critical failures (13 §1), incident comms (14 §2), operational budget (14 intro), build capacity (00 §9), bad-input handling (04 §§2, 4; 06 §3), recovery (06 §3, 14 §2).

---

## P. Open items needing product confirmation

These are **not gaps in the specs** — each has a concrete, buildable decision recorded above. They are flagged because they resolve an ambiguity in the source documents, not an explicit instruction.

1. **`support@contractiq.app`** is used as the placeholder contact for operator-set plan changes (03 §11) and in the expired-trial quota message (13 §5). No support address appears in either source document.
2. **NPS "session end"** is implemented as "review marked complete, or 15 minutes of inactivity" (10 §3). The PRD says only "at session end".
3. **Onboarding tip copy** (16 §5) is drafted here; the PRD requires the tips but names no wording.
4. **Re-processing an already-completed contract is refused** with `409 ALREADY_PROCESSED` (06 §3 step 2); only `uploaded` and `error` states proceed, and an operator re-run means setting `status='error'` first. Neither document states whether a user may re-run a successful extraction.
5. **Netlify Pro function timeout (26 s)** is assumed for `/process` (00 §6). The PRD budgets 30 s end-to-end but names no function-timeout tier.
6. **Expired free trial** ⇒ limit 0 with a distinct "Your free trial has ended" message, and `profiles.plan` left unchanged (13 §5). Neither document says what happens when `trial_ends_at` passes without an operator setting a plan.
7. **No self-service password reset at MVP** (03 §7). FR-01/US-001 scope auth to sign up, sign in and sign out; a forgotten password is an operator action via the Supabase dashboard. Confirm whether self-service reset should be added.
8. **Outbound email transport** is the project's SMTP credentials behind a `send-notification` Edge Function (14 §2a), chosen so no paid vendor is added beyond Supabase, OpenAI and Uptime Robot. Neither document names an email provider, though both the P0 incident email and the account-deletion confirmation are required.
9. **The public status page** is the Uptime Robot public status page rather than an in-app route (14 §2b). Both documents require a status page updated within 30 minutes of a P0 but name no artefact.
10. **Quota is consumed at upload and not refunded when a contract is deleted** (13 §5, 04 §2 step 7b). The PRD defines tiers in "analyses" and separately guarantees delete-anytime, but never says how the two interact. A failed upload and a failed extraction retry are both free; an uploaded-but-unprocessed contract is not.
11. **A `processing` contract older than 5 minutes is force-failed** to `error` with a retryable code (06 §3a). Neither document specifies a stuck-processing recovery rule.

---

## v1.1 amendments (PRD v1.1, 2026-09-21) — traceability for every PARTIAL / MISSING row in `docs/engineering/delta-v1.1.md`

Legend: **stub** / **planned** / **built** as in the registry (spec 21 §1.2). "Where" names the spec text that makes the row buildable; no row is marked without a location.

### Q. Header, personas, metrics (delta HDR-1 … L2)

| Delta row | Where |
|---|---|
| HDR-1 source of truth v1.1 | Every v1.1 amendment header; 00 v1.1 §A |
| §2 Paralegal persona (HIL, playbooks, Review mode, High-flag rule) | 20 §1, §4.1, §4.3 (human decides every High flag); 22 §4 (Review mode); 21 §1.2 `playbook.manage` |
| NS North Star = contracts processed with review completed, WoW, +15%, ≥ 4/user/month | 23 §4.1 `v_kpi_north_star_weekly`, `v_kpi_contracts_per_user_monthly`; 14 v1.1 §A relabel |
| L1 time-to-clarity ≤ 15 min | 23 §4.2 `v_kpi_time_to_clarity` |
| L1 task completion ≥ 85% funnel | 23 §4.3 `v_kpi_task_completion` |
| L1 % helpful / % honest / % harmless from `hhh_scores` | 22 §3, 23 §4.4 `v_kpi_hhh_weekly`; floors in 18 v1.1 §B |
| L2 risk-detection F1 ≥ 90%, SKIPPED | 20 §7 `risk-f1.ts`; 22 §12; 18 v1.1 §B GA row |

### R. Nine components, roadmap, dependencies, risks (delta Comp 1 … Internal risks)

| Delta row | Where |
|---|---|
| Comp 1 intake: `import.*` planned, disabled options naming phase | 21 §1.2, §5 route 31, §8; 04 v1.1 §A |
| Comp 2 PDF→text: `ingest.docx` / `ingest.ocr` stubs, `OcrAdapter`, `NullAdapter`, `contracts.ocr_confidence`, < 80% ⇒ re-upload, DOCX 422 | 21 §4, §4.1; 04 v1.1 §B; 06 v1.1 §D; 02 v1.1 §B |
| Comp 4 36-term MSA library with question / answer_format / display_rank | 05 v1.1 §A–§C; 06 v1.1 §A |
| Comp 5 playbook check (`playbook.manage`) | 20 §2.1–2.4, §3 routes 22–24, §4.5 |
| Comp 6 rank risks (`risk.flag`) | 20 §2.5, §3 route 19, §4.1, §6 |
| Comp 7 decide / escalate (`risk.escalate`; human decides every High flag) | 20 §2.6, §3 route 21, §4.2, §4.3, §5 |
| Comp 8 summary planned first build item; `qa.cross_contract` planned | 06 v1.1 §B; 07 v1.1 §B; 21 §1.2 |
| Comp 9 CRM push (`CrmAdapter`, `integration_events`, route 501) | 21 §4, §5 route 27, §6 |
| Cross-cutting feedback incl. `hhh_scores` | 22 §3–§4 |
| v0.1 placeholder tables + registry | 02 v1.1 §A; 21 §1; 00 v1.1 §C–§D |
| v0.2 MEP human-review acceptance (F1 ≥ 82% on instructor set, ≥ 50 human rows in `hhh_scores`) | 22 §8 `mep-acceptance.ts`; 18 v1.1 §B Alpha row |
| v0.3 summary · v0.4 query enhancer + page/reasoning editing · v1.0 red team, `guardrail_events`, `alert_rules`, cohorts · v1.1 DOCX, reminders · v1.2 OCR < 80%, `compare.contracts`, `esign.docusign` · v2 planned keys | 00 v1.1 §D; 06 v1.1 §B; 08 v1.1 §B; 07 v1.1 §D; 22 §9; 23 §1, §2, §5; 21 §4, §7; 20 §3 route 25; 21 §1.2 |
| Dependency: instructor golden set in `eval/datasets/msa-instructor/pdfs/` before v0.2 | 22 §1 dataset 1; 18 v1.1 §E |
| Dependency: majority-agreement risk labels before US-013 | 22 §1 dataset 5; 20 §7 (`agreement ≥ 2`) |
| External dep OCR vendor (NullAdapter, ~100-contract sample) | 21 §4 (NullAdapter); 21 §1.2 `ingest.ocr` row flip condition + §4.1 (built only after `ocr-accuracy.ts` passes on `eval/datasets/ocr-sample/`, ~100 labelled scanned SMB contracts — 22 §12); 18 v1.1 §E |
| External dep CRM vendor (`CrmAdapter`, one vendor at a time) | 21 §4 (`CrmAdapter` + NullAdapter; one vendor enforced by the `serverConfig` refine that rejects both OAuth client pairs, 01 v1.1 §B) |
| Internal risk: re-baselining after the 36-term library; matcher version; never compare across libraries | 22 §1 (`MATCHER_VERSION`, `Term_Library_Version`, re-baseline step); 17 v1.1 §B–§C |
| Internal risk: risk flags without ground truth ⇒ `risk-f1` SKIPPED | 20 §7 |

### S. User flows and stories (delta Flow 2 step 3 … US-017)

| Delta row | Where |
|---|---|
| Flow 2 step 3 `/settings` capability table | 21 §3 |
| Flow 3 step 1 disabled import/DOCX/scanned options | 21 §8; 04 v1.1 §A |
| Flow 3 step 4 four-step indicator incl. "summarising" | 06 v1.1 §B (`ProcessingSteps`) |
| Flow 3 step 5 summary above terms; Risk panel empty state naming phase | 07 v1.1 §A–§B; 20 §4.1 |
| Flow 3 step 8 "High risk — recommend human/legal review" | 20 §4.1 `HighRiskLabel`; 07 v1.1 §F; 16 v1.1 §A |
| Flow 3 step 10 Review mode → `hhh_scores` | 22 §4; 07 v1.1 §E |
| Flow 4 step 2 query enhancement gated by the classifier | 08 v1.1 §B |
| Flow 4 step 7 escalation offer after ~3 turns; `/escalate` stub | 20 §5.1, §4.2; 08 v1.1 §C |
| US-005 custom terms carry `reasoning` | 06 v1.1 §A (custom terms share the schema) |
| US-009 edit value, page, reasoning ≤ 2 s; `original_ai_value/page/reasoning` | 07 v1.1 §D; 02 v1.1 §B; 12 v1.1 §B route 9 |
| US-013 (every acceptance clause) | severity/citation/why/confidence → 20 §2.5, §6; absence rules DPA/BAA → 20 §2.4; High ⇒ human decision before complete → 20 §4.3; "this flag was wrong" → 20 §4.4; F1 ≥ 90% → 20 §7, 18 v1.1 §B; **until built:** 501 `risk.flag` → 20 §3; `RiskPanel` empty state → 20 §4.1; `risk_f1` SKIPPED → 20 §7 |
| US-014 (every clause) | upload/edit rules, one active per type per workspace → 20 §2.1, §4.5, §3 routes 22–24; `rule_type` presence/absence/threshold/pattern, severity, rationale → 20 §2.2; seeded default MSA playbook (five rules) → 20 §2.4; versioned, version on every flag → 20 §2.2, §2.5; **until built:** tables with RLS → 02 v1.1 §A/§D; `PlaybookAdmin` hidden → 20 §4.5; routes 501 `playbook.manage` → 20 §3 |
| US-015 (every clause) | one extra GPT-4o call, ≤ 200 words, obligations per party, `contracts.summary_md`, rendered above terms, `[Page X]` per factual sentence, ≤ 10 s P95, ≤ $0.03, scored in `hhh_scores` → 06 v1.1 §B; 07 v1.1 §B; 22 §2 (summary subject type) |
| US-016 (every clause) | connect CRM once → 21 §5 routes 35–37, §6a `integration_connections` (per-user, tokens in Vault); pushed automatically after processing → 06 v1.1 step 11b, 21 §5 route 27; display_rank ≤ 12 terms, idempotent per contract, `integration_events`, failed push never blocks → 21 §5 route 27, §6; **until built:** `CrmAdapter` + `NullAdapter` `NOT_CONFIGURED`, 501 with key → 21 §4, §5 |
| US-017 (every clause) | `key_dates` derived from Contract end date / Notice to not auto renew / Renewal Period / Auto Renewal → 21 §7.2; 30/60/90 offsets → 21 §7.1, route 30; email + in-app → 21 §7.3; links to contract and term → 21 §7.4; edit re-derives → 21 §7.2, 07 v1.1 §D; **until built:** tables, `pg_cron` + `send-notification` stub → 21 §7.3, 02 v1.1 §C |
| FR-02 DOCX ⇒ 422 `UNSUPPORTED_FORMAT` | 04 v1.1 §B; 01 v1.1 §A |
| FR-04 "Why?" shows `source_sentence` and `reasoning` | 07 v1.1 §C |
| FR-13 RLS on placeholder tables | 02 v1.1 §D, §E |
| FR-14 single paste-and-run file | `supabase-schema.sql` v1.1 section; 02 v1.1 |

### T. Agent table (delta rows)

| Agent | Where |
|---|---|
| Ingestion & OCR (DOCX/OCR stub, < 80% ⇒ reject) | 21 §4.1; 04 v1.1 §B |
| Extraction agent: `reasoning` in output; required field not found ⇒ flag for review | 06 v1.1 §A, §C |
| Summariser | 06 v1.1 §B |
| Playbook loader (versioned rules; human confirms before activation) | 20 §2.2, §4.5 |
| Risk & Compliance (suggests; human decides every High) | 20 §4.1, §4.3 |
| Contract Chat (+ enhanced query; ~3 turns ⇒ offer; takes no action) | 08 v1.1 §B–§C |
| Comparison (clause diff; new High ⇒ flagged; stub 501) | 20 §3 route 25 |
| CRM pusher (failure ⇒ notice, retry, never blocks) | 21 §5 route 27 |
| Reminder scheduler (30/60/90; re-derive on edit) | 21 §7 |
| Escalation router (`escalations` row; human closes) | 20 §2.6 (`closed_by` service-role only) |
| Feedback logger + `hhh_scores` | 22 §3–§4 |

### U. Constraints, technical requirements, grounding, prompts (delta §5–§8 rows)

| Delta row | Where |
|---|---|
| Summary ≤ 10 s P95 | 06 v1.1 §B (10 s timeout, deferral rule) |
| Cost incl. summary ≤ $0.03 | 06 v1.1 §B input bounding; 23 §4.5 `summary_usd` |
| Sampling ≥ 200/week; cohorts 1–2% → 2–10% → GA; `profiles.rollout_cohort`; 20% human, judge the rest | 22 §7; 23 §5; 18 v1.1 §B; 02 v1.1 §B |
| Backend: planned routes 501 with capability key (P-4) | 21 §1.3; 12 v1.1 §A; 01 v1.1 §A |
| Integrations layer: interface + NullAdapter (P-2) | 21 §4 |
| `LlmProvider` `model.extraction` / `model.chat` / `model.judge` separately configurable (R-31) | 06 v1.1 §A; 01 v1.1 §B; `.env.example` v1.1 |
| Eval suite: every §10 metric has a runner; unmeasurable ⇒ SKIPPED (P-5) | 22 §12; 18 v1.1 §C |
| `max_tokens` 3,000 / 1,000 / 500; temperature 0.2 summary | 06 v1.1 §A–§B; 01 v1.1 §B |
| Judge model separate and stronger, never in a product prompt | 22 §6.1 (`openai-client` refusal rule) |
| Model-choice trade table | 06 v1.1 §A (per-purpose ids), 08 v1.1 §B (cheaper-model candidate), 22 §6 (judge) — the trade numbers are PRD text; the spec makes each row switchable by config and measured by the eval |
| `RetrievalStrategy`: full-context built, vector stub with `contract_chunks vector`, graph planned, n8n adapter | 08 v1.1 §D; 02 v1.1 §A; 21 §4 `rag/` |
| Extraction prompt asks each term's question + answer_format (R-21c) | 06 v1.1 §A |
| Failure-seeded pool `eval/failures/` (R-23) | 22 §11 |
| Summary prompt; risk prompt (conditional CoT per rule) | 06 v1.1 §B; 20 §6 |

### V. Harmless policy, red teaming (delta §9 rows)

| Rule | Status (PRD §9) | Where |
|---|---|---|
| 1 profanity/hate in or out; `guardrail_events` | stub | 13 v1.1 §A row 1 |
| 2 competitor disparagement | stub | 13 v1.1 §A row 2 |
| 3 stay within the contract; "I can only answer about this contract" + rephrase; injection screened and logged | built | 13 v1.1 §A rows 3 (two keys) |
| 4 escalate after ~3 turns / High flag / user request; route 501; table present | stub | 20 §5, §3 route 21; 13 v1.1 §A row 4 |
| 5 never solicit PII | stub | 13 v1.1 §A row 5 |
| Red teaming: `eval/redteam/` every deploy; `harmless.redteam_pass_rate` gate | 22 §9; 18 v1.1 §B, §D |

### W. Evaluation strategy (delta §10 rows)

| Delta row | Where |
|---|---|
| Dataset 1 instructor golden set (primary) · 3 synthetic corpus with provenance README · 5 majority-agreement risk labels · 6 corrections + HHH rows (opt-in) | 22 §1; 17 v1.1 §A |
| HHH questionnaire H1–H11, O1–O9, A1–A9 (29 codes, verbatim, polarity, per-code column) | 22 §2 (the table); `hhh_scores` columns `h1…a9` 02 v1.1 §A / `supabase-schema.sql` §A8 |
| `hhh_scores` table (contract_id, term_id/message_id, evaluator human/llm-judge, boolean per code, pillar verdicts, judge model, prompt version, created_by) + sheet-compatible export | 22 §3, §5 |
| LLM-as-judge: `hhh-judge.ts`, `judge-precision.ts`, P/R ≥ 0.70 gate, SKIPPED until 50 human rows, re-measure on change | 22 §6 |
| Eval plan rows: risk F1 / HHH human / HHH judge / judge P/R / red team | 22 §12; 20 §7 |
| Monitoring: PASS/FAIL/SKIPPED, never PASS when unmeasurable | 22 §12; 18 v1.1 §C |
| Weekly drift incl. human-vs-judge overlap | 22 §7; 14 v1.1 §D |
| Report `Prompt_Version` + matcher version | 22 §1, §12; 17 v1.1 §C |
| Foundry JSONL `eval/export/foundry.jsonl` | 22 §10 |

### X. Production readiness (delta §11 rows)

| Delta row | Where |
|---|---|
| HHH table: weekly scoring on H1–H11 / O1–O9 / A1–A9; 36-term overwhelm mitigated by display_rank ≤ 12 | 22 §7 (weekly), §2; 05 v1.1 §C |
| Launch stages Alpha / Measurement (1–2%) / Beta (2–10%) / GA with HHH floors, ≥ 200 samples/week, ≥ 50 human rows, judge P/R, red-team 100%, page accuracy ≥ 92%, risk F1 condition | 18 v1.1 §B |
| Four-reference threshold rationale | 18 v1.1 §B intro |
| Observability rows: cost, time per task, error rate per component (stage names components 1–9), wrong guardrail triggers, wrong tool calls SKIPPED, task adherence, intent resolution + escalation rate, content safety, HHH alert thresholds (`alert_rules` + nightly job → `alert_events`), budget | 23 §3 (mapping), §1, §2, §4; 02 v1.1 §B (`processing_runs.stage`) |
| Accountability: HIL paths per agent; escalation route; limitations copy incl. "does not yet flag risks"; registry at `/settings` | §T above; 20 §3 route 21; 21 §3; 16 v1.1 §A |
| Transparency: benchmarks incl. HHH %, matcher + prompt version on `/trust`; disclosures incl. reasoning and registry | 15 §2 `/trust` now publishes HHH percentages (`v_kpi_hhh_weekly`), `Matcher_Version` and `Prompt_Version` from the latest report (spec 22 §12 summary) and links `/settings#capabilities`; reasoning disclosure 07 v1.1 §C |
| Reliability & Safety: injected instructions screened and logged; health monitoring via `guardrail_events`, `alert_rules` | 13 v1.1 §A `prompt_injection`; 23 §6; 14 v1.1 §E |

### Y. Appendix A — P-1 … P-7

| P | Where |
|---|---|
| P-1 registry `src/lib/capabilities.ts`, `GET /api/capabilities`, `/settings` table | 21 §1–§3 |
| P-2 interface + `NullAdapter` per integration under `src/lib/integrations/<name>/` returning `NOT_CONFIGURED` | 21 §4 |
| P-3 placeholder tables in the SQL with RLS and `-- capability:` comment | `supabase-schema.sql` v1.1 section; 02 v1.1 §A, §D |
| P-4 routes registered, `501 NOT_IMPLEMENTED` with capability key; one new `AppError` code | 21 §1.3; 12 v1.1 §A; 01 v1.1 §A |
| P-5 runner + `SKIPPED` row per unmeasurable metric | 22 §12; 20 §7; 18 v1.1 §C |
| P-6 UI hidden, not absent (`<Capability>` wrapper; empty state naming phase; E2E asserts hidden) | 21 §1.4; 20 §4; 07 v1.1 §B, §E; 18 v1.1 §A E2E |
| P-7 spec per placeholder under `docs/implementation/` | this file set: 20, 21, 22, 23; 00 v1.1 §C |

### Z. Appendix B — capability registry keys (all 36)

| Key(s) | Status | Stub artefacts → where |
|---|---|---|
| `ingest.pdf_text`, `classify.contract_type`, `extract.key_terms`, `qa.single_contract`, `retrieval.full_context`, `export.csv_pdf` | built | 21 §1.2 (registry rows); existing specs 04, 06, 05 v1.1 (36-term library), 08, 15 |
| `ingest.docx` | stub | 21 §4 (`DocxExtractor`), §4.1 (422 `UNSUPPORTED_FORMAT`) |
| `ingest.ocr` | stub | 21 §4 (`OcrAdapter`, NullAdapter), 02 v1.1 §B (`ocr_confidence`) |
| `import.drive` / `import.dropbox` / `import.sharepoint` | planned | 21 §1.2, §5 route 31, §8 |
| `extract.summary` | planned → first build item | 06 v1.1 §B |
| `playbook.manage` | stub | 20 §2.1–2.4, §4.5, §3 |
| `risk.flag` | stub | 20 §2.5, §3, §4.1, §7 |
| `risk.escalate` | stub | 20 §2.6, §3 route 21 |
| `redline.word`, `qa.cross_contract`, `retrieval.graph`, `billing` | planned | 21 §1.2 (registry only); `redline`/`graph` NullAdapters 21 §4 |
| `retrieval.query_enhancer` | planned → first build item | 08 v1.1 §B |
| `retrieval.vector` | stub | 08 v1.1 §D; `contract_chunks` 02 v1.1 §A |
| `retrieval.n8n` | stub | 08 v1.1 §D; 21 §4 `rag/` (config URL, 501 when unset) |
| `compare.contracts` | stub | 20 §3 route 25 |
| `reminders.key_dates` | stub | 21 §7 |
| `crm.hubspot` / `crm.salesforce` | stub | 21 §4, §5 route 27, §6 |
| `esign.docusign` | stub | 21 §4, §5 route 28 |
| `eval.golden_set_instructor` | planned → first build item | 22 §1 |
| `eval.hhh_human` | planned → first build item | 22 §3–§5 |
| `eval.hhh_judge`, `eval.judge_precision` | stub (SKIPPED) | 22 §6 |
| `eval.redteam`, `eval.foundry_export` | planned → first build items | 22 §9, §10 |
| `observe.guardrail_events`, `observe.alerts`, `rollout.cohorts` | stub | 23 §1, §2, §5 |

### P (continued). Open items needing product confirmation — added in v1.1

12. **`rule_type` vocabulary.** PRD US-014 names `presence`, `absence`, `threshold`, `pattern`; the Stage 2 invocation for this run named `threshold | presence | absence | text`. The PRD governs *what*: the schema and spec 20 §2.2 use **`pattern`**; `text` is treated as a synonym for it and is not a stored value. Confirm.
13. **Summary input is bounded, not the full text.** PRD US-015 caps the summary at ≤ $0.03 while §6 mandates GPT-4o; a full 15,000-token document at $0.005/1k already costs $0.075. The summariser therefore receives the extracted terms plus a 3,000-token window (06 v1.1 §B), ≈ $0.030. The alternative lever is `OPENAI_MODEL_SUMMARY` = a cheaper model (the PRD trade table's candidate). Confirm which.
14. **Summary deferral.** A summary that cannot start with ≥ 11 s left in the 24 s handler budget is generated by a follow-up `POST /api/contracts/{id}/summary` from the results page. The PRD says "at process time"; the deferral keeps the ≤ 30 s e2e P95 and the ≤ 10 s summary P95 both true. Confirm.
15. **Risk-call cost.** A per-rule risk call (≈ $0.09) would breach the ≤ $0.25 per-analysis budget once `risk.flag` is built; it is reported as its own `purpose='risk'` line (20 §6.1) until the budget is revisited.
16. **`PlaybookAdmin` "hidden".** Interpreted as: no navigation link; the route renders the seeded playbook read-only with the phase note (20 §4.5), satisfying P-6's "hidden, not absent".
17. **SME scoring without roles.** With no roles at MVP (13 §1), owners score their own contracts in Review mode; the legal SME scores the golden set in Review mode on the dedicated eval account and scores production samples through the sheet export → fill → import round-trip (`hhh-sheet.ts --import`, service role, `scorer_role='sme'`), never by logging into users' accounts (22 §3, §5, §8). Team roles (v1.2) could replace the import with in-app SME access.
22. **`v_kpi_hhh_weekly` counting population** = human rows + judge rows once the judge gate is met, so the ≥ 200/week rule is satisfiable with a 20 % human share (23 §4.4); humans alone must reach 200 while the gate is unmet (Assumption 17).
23. **CRM auto-push runs inside `/process`** (3 s bound, step 11b) rather than a queue; a timeout is a retryable `integration_events` failure, never a failed run.
18. **Judge model provider.** Assumption 17 names "GPT-5 or Claude Opus class"; the settled decision that OpenAI is the sole wired provider means `OPENAI_MODEL_JUDGE` is an OpenAI id (22 §6.1). Wiring an Anthropic judge is an adapter addition to `openai-client.ts`'s `LlmProvider`, not done here.
19. **Escalation offer while the route is a stub** is a passive note, not a button (20 §4.2), so the UI never offers an action that returns 501.
20. **Query-enhancer model** defaults to `gpt-4o`; the PRD's cheaper-model candidate is a config switch pending the groundedness eval (08 v1.1 §B).
21. **Unresolved-turn definition** (20 §5.1) — the PRD says "~3 turns without resolution"; the spec defines "unresolved" as fallback / unverified citation / off-scope reply, consecutive.

**Superseded v1.0 rows in §F/§G:** "max_tokens 2000 / 1000" → 3000 / 1000 / 500 (summary) — 06 v1.1 §A–§B, 01 v1.1 §B; "HHH: top 10–12 terms by default" → display_rank ≤ 12 of 36 (05 v1.1 §C).
