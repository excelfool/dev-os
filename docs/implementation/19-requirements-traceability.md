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
