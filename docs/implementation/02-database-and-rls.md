# 02 — Database, RLS and Storage

**Sources:** engineering-doc §7 (all subsections), §6.2 authorisation; PRD FR-13, FR-14, Assumption 9, Assumption 13.
**Runnable artefact:** `docs/implementation/supabase-schema.sql` — copy to `supabase/database.sql` and paste into the Supabase SQL Editor of a fresh project. This file explains it and specifies the tests that prove it.

---

## 1. How to apply

1. Create the Supabase project (Free for development; **Pro must be provisioned before beta** — the free tier's 500 MB DB / 1 GB Storage breaches at ~200 contracts).
2. Open SQL Editor → paste `supabase-schema.sql` → Run. It is idempotent; re-running is safe.
3. Before running section 17 (cron), store the service-role key in Vault and substitute `<PROJECT_REF>`:
   `select vault.create_secret('<SERVICE_ROLE_KEY>', 'service_role_key');`
4. Authentication → Providers → Email: **"Confirm email" OFF** for MVP (A-05). Turning it on later requires no code change.
5. Run `npm run db:types` to regenerate `src/types/database.types.ts`.

Verification queries are listed at the bottom of the SQL file. Expected: 14 tables in `public`, `rowsecurity = true` on all 14, bucket `contracts` with `public = false`, three policies on `storage.objects`.

---

## 2. Table reference (what each column is for)

| Table | Row means | Lifetime |
|---|---|---|
| `profiles` | One per auth user. Holds `plan`, `trial_ends_at`, `feedback_opt_in`, and the deletion-proof quota counter `analyses_used` + `quota_period_start` (spec 13 §5). | Created by the `on_auth_user_created` trigger; deleted by cascade from `auth.users`. |
| `contracts` | One upload. `contract_text` (with `[PAGE N]` markers) is the **single source of truth** for every AI call — neither processing nor chat re-downloads the PDF. | Until the user deletes it. `file_path` may become NULL (Storage failure or 90-day purge) without affecting anything else. |
| `key_terms` | One extracted term, standard or custom. `original_ai_value` is captured at insert and never overwritten. | Cascade from `contracts`. Re-processing replaces rows via the `(contract_id, term_name)` unique constraint. |
| `custom_key_terms` | A term the user asked for **before** processing. `is_manual = true` (FR-05). | Cascade from `contracts`. |
| `chat_sessions` | Exactly one per contract (`UNIQUE (contract_id)`), which is what makes "reopening loads the previous session" deterministic (US-012). | Cascade from `contracts`. |
| `chat_messages` | One turn. `cited_pages` drives the citation chips; `citation_verified=false` renders the "unverified citation" notice. | Cascade from `chat_sessions`. |
| `user_feedback` | One rating per (user, contract), upsertable. `contract_type` is denormalised so feedback can be segmented by type without a join (PRD §11 Fairness). | Cascade. |
| `processing_runs` | One stage timing. `stage='total'` powers the ≤ 30 s P95 gate. | Cascade. |
| `openai_calls` | One row **per attempt**, including failures, with tokens, cost, latency, outcome and `prompt_version`. | Cascade. |
| `activity_events` | First-party product analytics (retention, NPS trigger, client-side timing targets). Never holds contract or chat content. | Cascade. |
| `nps_responses` | NPS score, at most one per user per 30 days (service-layer rule). | Cascade. |
| `rate_limits` | Fixed-window counter keyed `(user_id, bucket, window_start)`. **No client access at all** — clients must not be able to read or reset their own counters. | Rows older than 7 days may be pruned by the nightly job. |
| `analysis_slots` | 100 seeded rows, one per concurrent-analysis slot. Claimed with `FOR UPDATE SKIP LOCKED` (transaction-scoped and connection-pool-safe, unlike a session advisory lock) and auto-reclaimed after 2 minutes of staleness so a crashed request cannot leak a slot. **No client access.** | Permanent. |
| `system_status` | Single row driving the incident banner without a deploy. Readable by any authenticated user; writes service-role only. | Permanent. |
| `term_corrections` (view) | Every edited term joined to contract type, prompt version and the owner's `feedback_opt_in`. `security_invoker = true`, so a user sees only their own corrections. | Derived. |

### Column semantics that carry product meaning

- `key_terms.value IS NULL` ⇒ the model searched for the term and did not find it. The UI renders **"Not found in document"** with a 0% confidence badge. The term is still shown, so the user learns what was searched for.
- `key_terms.confidence_score` is an **integer 0–100**. The model returns 0.0–1.0; conversion happens once, in `extraction-service` (A-04).
- `key_terms.is_source_verified = false` ⇒ the verbatim `source_sentence` was not found in `contract_text`; confidence is capped at 49 so the term renders with the low-confidence warning ("a term with no supporting sentence is treated as unreliable").
- `key_terms.display_rank ≤ 12` ⇒ expanded by default; the rest sit under "Show all terms" (A-11).
- `contracts.last_accessed_at` is the 90-day retention anchor, touched on every `GET /api/contracts/{id}` (A-10).
- `contracts.status='error'` plus `error_code`/`error_message` is what lets the user retry **without re-uploading**.
- `contracts.processing_started_at` is set when a run begins and cleared on success. It is the **only** staleness anchor for a stuck run: `updated_at` is bumped by the results page's 2-second poll (which touches `last_accessed_at`), so it cannot be used for this.

---

## 3. Triggers and functions

| Object | Type | Behaviour |
|---|---|---|
| `set_updated_at()` | trigger fn | Sets `new.updated_at = now()`. Attached BEFORE UPDATE to `profiles`, `contracts`, `user_feedback`, `system_status` — every table that has an `updated_at` column. |
| `handle_new_user()` / `on_auth_user_created` | AFTER INSERT ON `auth.users`, SECURITY DEFINER | Inserts `profiles(id, email, plan='free_trial', trial_ends_at=now()+14 days, feedback_opt_in=false)`. `ON CONFLICT DO NOTHING` keeps signup idempotent. |
| `enforce_custom_term_limit()` | BEFORE INSERT ON `custom_key_terms` | Raises `CUSTOM_TERM_LIMIT` when the contract already has 5. The cap therefore holds even if the API is bypassed (FR-05, §14 traceability). |
| `increment_rate_limit(user_id, bucket, limit)` | SECURITY DEFINER fn | Atomic `INSERT … ON CONFLICT DO UPDATE` returning the new count for the current hour window. Execute is revoked from `public`/`anon`/`authenticated` and **explicitly granted to `service_role`** (the blanket revoke removes the grant service_role would otherwise inherit). |
| `acquire_analysis_slot(holder)` / `release_analysis_slot(slot, holder)` | SECURITY DEFINER fns | Claim and free one of the 100 `analysis_slots` rows. Same revoke/grant posture: `service_role` only. |
| `reset_quota_on_plan_change()` / `on_plan_change_reset_quota` | BEFORE UPDATE OF `plan` ON `profiles` | A plan change resets `analyses_used` to 0 and starts a fresh `quota_period_start` (calendar month for paid plans, `now()` for a re-granted trial), so a user moved from `free_trial` to `starter` mid-month gets the full 10 analyses the PRD promises rather than the trial's remainder. |
| `consume_analysis_quota(user_id, period_start)` / `refund_analysis_quota(user_id)` | SECURITY DEFINER fns | Atomically roll the quota period, increment (or decrement on refund) `profiles.analyses_used`, and return the new usage. Monotonic within a period, so deleting a contract does **not** free quota. `service_role` only. |
| `persist_key_terms(contract_id, terms jsonb, detected_type, type_mismatch, first_term_ready_ms)` | SECURITY **INVOKER** fn, granted to `authenticated` | The whole "replace terms and complete the contract" step in **one statement**, because PostgREST exposes no multi-statement transaction. Deletes the contract's existing `key_terms`, inserts the validated set (setting `original_ai_value = value`), updates `contracts` to `status='completed'` with `processed_at`, `detected_type`, `type_mismatch_warning` and `first_term_ready_ms`, then returns the rows ordered by `display_rank, term_name`. Any error rolls the whole function back, so **partial `key_terms` rows can never survive**. Security invoker means RLS still applies — the ownership lookup returns nothing for a non-owner and the function raises `NOT_FOUND`. |

---

## 4. Indexes and the query each serves

| Index | Query |
|---|---|
| `idx_contracts_user_created (user_id, created_at DESC)` | Dashboard list, default sort, last-5 card |
| `idx_contracts_user_type (user_id, contract_type)` | NDA/MSA breakdown counts |
| `idx_contracts_user_name (user_id, file_name)` | Sort by name |
| `idx_contracts_retention (last_accessed_at) WHERE file_path IS NOT NULL` | Nightly purge scan |
| `idx_contracts_status (user_id, status)` | Error/retry listing |
| `idx_contracts_stale_processing (processing_started_at) WHERE status='processing'` | The 5-minute stale-run reclaim scan |
| `idx_key_terms_contract (contract_id, display_rank, term_name)` | Terms panel ordering |
| `idx_key_terms_user_edited (user_id, is_edited) WHERE is_edited` | Correction-rate queries |
| `idx_key_terms_low_conf (contract_id) WHERE confidence_score < 50` | Low-confidence invariant job |
| `idx_custom_terms_contract` | Preview list, cap check |
| `idx_chat_sessions_contract` | Session lookup |
| `idx_chat_messages_session_created (session_id, created_at ASC)` | The ≤ 200-message ascending history load in one index scan |
| `idx_feedback_contract` | Feedback lookup per contract |
| `idx_processing_runs_stage_created (stage, created_at DESC)` | P95 latency queries |
| `idx_openai_calls_created`, `idx_openai_calls_contract` | Daily cost rollup; per-analysis cost check |
| `idx_activity_user_created`, `idx_activity_type_created` | Retention and event analytics |
| `idx_nps_user_created` | 30-day NPS eligibility check |

---

## 5. RLS policy matrix

`authenticated` role only; `anon` has no policy on any table, so an anonymous visitor has **no database read path** (engineering-doc §3).

| Table | SELECT | INSERT | UPDATE | DELETE |
|---|---|---|---|---|
| `profiles` | `id = auth.uid()` | — (trigger) | `id = auth.uid()` | — (cascade) |
| `contracts` | own | own | own | own |
| `key_terms` | own | own | own | own |
| `custom_key_terms` | own | own | own | own |
| `chat_sessions` | own | own | own | own |
| `chat_messages` | own | own | — | own |
| `user_feedback` | own | own | own | own |
| `processing_runs` | own | own | — | — |
| `openai_calls` | own | own | — | — |
| `activity_events` | own | own | — | — |
| `nps_responses` | own | own | — | — |
| `rate_limits` | **none** | **none** | **none** | **none** |
| `analysis_slots` | **none** | **none** | **none** | **none** |
| `system_status` | `true` (any authenticated user) | — | — | — |

"own" = `USING (user_id = auth.uid())` and, on INSERT/UPDATE, `WITH CHECK (user_id = auth.uid())`.

`chat_messages` has no UPDATE policy on purpose: a conversation record is append-only.

---

## 6. Storage

Private bucket `contracts`, created by SQL (`INSERT INTO storage.buckets`) — **never via the dashboard** (Assumption 13). `file_size_limit = 10485760`, `allowed_mime_types = {application/pdf}`.

Object path: `{user_id}/{contract_id}/{filename}.pdf` **within** the `contracts` bucket, which is the same thing FR-14 writes as `contracts/{user_id}/{contract_id}/{filename}.pdf` (bucket name + object name). This is why `(storage.foldername(name))[1]` is the user id in all three policies.

Three policies on `storage.objects` — INSERT, SELECT, DELETE — each `bucket_id = 'contracts' AND auth.uid()::text = (storage.foldername(name))[1]`. No UPDATE policy: PDFs are immutable once uploaded.

Downloads use **1-hour signed URLs only** (`SIGNED_URL_TTL_SECONDS=3600`).

**If the Storage statements are omitted**, uploads fail at the Storage layer, the upload route catches it, leaves `file_path = NULL`, and returns `201` with `storage_available: false`. The product keeps working through the text viewer because `contract_text` lives in the DB. This degraded state is specified, not accidental.

`filename` sanitisation before building the path: NFKC-normalise, replace every character outside `[A-Za-z0-9._-]` with `_`, collapse repeats, truncate to 100 chars, force a `.pdf` suffix. The original filename is stored unmodified in `contracts.file_name` for display.

---

## 7. Volume expectations

At the PRD operating point (500 active users, ~2,000 contracts/month): ~2,000 `contracts` rows/month at ~60 KB of `contract_text` each (~120 MB/month), ~40,000 `key_terms` rows/month, ~5 GB/month of PDFs before the 90-day purge, low-thousands `chat_messages`. Alert at **70% of the Supabase storage allowance** (spec 14).

---

## 8. Required tests (`tests/rls/`) — this suite gates the build

Two real test accounts, A and B, created against a local Supabase, each using the **anon key** (never service_role).

1. For every table in §5: B cannot `SELECT`, `UPDATE` or `DELETE` any row owned by A (expect 0 rows / policy violation, never data).
2. For every table: B cannot `INSERT` a row carrying `user_id = A` (WITH CHECK violation).
3. `rate_limits` and `analysis_slots`: A cannot select, insert, update or delete anything at all, including their own rows; and A cannot `EXECUTE` `increment_rate_limit`, `acquire_analysis_slot` or `release_analysis_slot`.
3b. `persist_key_terms`: A **can** execute it for a contract A owns; executing it for B's contract raises `NOT_FOUND` and changes nothing.
4. `system_status`: A can select; A cannot update.
5. `term_corrections`: A sees only A's edited terms; B's rows are absent.
6. Storage: B cannot upload to `A/…`, cannot list or download `A/…`, and cannot delete `A/…`.
7. Signed URL expiry: a URL created with a 1-second TTL is rejected after it lapses.
8. Cascades: deleting a `contracts` row removes its `key_terms`, `custom_key_terms`, `chat_sessions`, `chat_messages`, `user_feedback`, `processing_runs` and `openai_calls` rows.
9. `enforce_custom_term_limit`: a direct 6th insert via the client raises, even bypassing the API.
10. `on_auth_user_created`: signing up creates exactly one `profiles` row with `plan='free_trial'` and `trial_ends_at ≈ now() + 14 days`.

This suite is the executable form of PRD Assumption 9 ("RLS correctly isolates user data") — the assumption is treated as **unproven until these tests pass**.

**STATUS (2026-09-20): PASSING — 45 checks, `npm run test:rls`.** Assumption 9 is
now evidenced, not asserted.

**Recorded deviation — the suite runs against the dev project, not a local
Supabase.** §8 above specifies "a local Supabase". No local stack is running, so
`tests/rls/harness.ts` targets the project in `.env.local`. It creates and
destroys its own two accounts and touches no other data; teardown is the only
service-role use and lives outside `src/**`, so the client-bundle grep is
unaffected. Consequence: the gate needs network and real credentials, so it is
not hermetic and cannot run in an offline CI. Accepted for now — nothing in this
project runs CI yet. `supabase start` plus a `SUPABASE_DB_URL` pointing at the
local stack is the fix when CI arrives.

**Fixture rule for every suite that touches `key_terms`.** `persist_key_terms`
**replaces** a contract's terms — it deletes the existing rows and inserts the
new set (spec 06 §3 step 11), which also clears `is_edited`. Any test asserting
on a term's state must therefore **own that state**: seed or edit the term
inside the test (or its own `beforeAll`), never rely on a shared fixture set up
earlier in the file. This caused a false failure in the `term_corrections` check
during Stage 5 — the product was correct and the test was wrong.

---

## v1.1 amendments (PRD v1.1, 2026-09-21)

Everything above stands. This section adds what `supabase-schema.sql`'s delimited section `-- ===== v1.1 additions (PRD v1.1, 2026-09-21) =====` creates. Every new table is headed by a `-- capability: <key> | status: stub|planned | phase: <phase>` comment (P-3), has RLS enabled, and has policies. Every column added to an existing table uses `alter table … add column if not exists`. The file remains a single paste-and-run, idempotent script.

### A. New tables (14) — the verification count becomes **28 tables** in `public`

| Table | Capability header | Row means | Spec |
|---|---|---|---|
| `playbooks` | `playbook.manage` · stub · Phase 1 | One playbook version per contract type per workspace (`user_id IS NULL` = the seeded system default) | 20 §2.1 |
| `playbook_rules` | `playbook.manage` · stub · Phase 1 | One versioned rule; never updated in place (`superseded_at`) | 20 §2.2 |
| `risk_flags` | `risk.flag` · stub · Phase 1 | One rule verdict per contract; `requires_human_review` forced true for High by CHECK | 20 §2.5 |
| `escalations` | `risk.escalate` · stub · Phase 1 | One hand-off request; closed only by service role | 20 §2.6 |
| `integration_connections` | `crm.hubspot` / `crm.salesforce` · stub · Phase 1 | One per `(user, target)`: the "connect once" record; tokens live in Vault via `credential_ref` | 21 §6a |
| `integration_events` | `crm.hubspot` / `crm.salesforce` / `esign.docusign` · stub · Phase 1 | One push/pull/webhook attempt, including `not_configured` attempts | 21 §6 |
| `key_dates` | `reminders.key_dates` · stub · v1.1 | One derived (or manual) date per `(contract, kind)` | 21 §7.1 |
| `reminders` | `reminders.key_dates` · stub · v1.1 | One `(key_date, offset, channel)` reminder with `send_at` | 21 §7.1 |
| `hhh_scores` | `eval.hhh_human` · planned · — | One questionnaire answer set per subject per evaluator (`scorer_role` owner/sme for human rows); verdicts computed by trigger | 22 §3 |
| `guardrail_events` | `observe.guardrail_events` · stub · v1.0 | One rule firing; hash only, never text | 23 §1 |
| `alert_rules` | `observe.alerts` · stub · v1.0 | One threshold rule; seeded with six | 23 §2.1 |
| `alert_events` | `observe.alerts` · stub · v1.0 | One firing of a rule | 23 §2.2 |
| `contract_chunks` | `retrieval.vector` · stub · v2 | One text chunk with `embedding vector(1536)` — **present, unused**; no code writes it | 08 v1.1 §D |
| `eval_gates` | `eval.judge_precision` · stub · — | Machine-written gate state (`judge_gate`, `sample_week`) | 23 §4 |

### B. Columns added to existing tables

| Table | Column | Why |
|---|---|---|
| `key_terms` | `reasoning text` | One-sentence reasoning from the model (FR-04, R-16) |
| `key_terms` | `original_ai_reasoning text`, `original_ai_page integer` | Preserved originals for page and reasoning edits (US-009); captured at insert by `persist_key_terms`, never overwritten |
| `key_terms` | `is_required boolean not null default false` | "required field not found ⇒ flag for review" (PRD agent table) — spec 06 v1.1 §C |
| `key_terms` | `page_edited boolean default false`, `reasoning_edited boolean default false` | Per-field "Edited" badges (`is_edited` stays the value badge and the correction-rate signal) |
| `contracts` | `summary_md text`, `summary_status text check in ('none','pending','processing','completed','error') default 'none'`, `summary_uncited boolean default false`, `summary_generated_ms integer`, `summary_error_code text`, `summary_claimed_at timestamptz` | US-015 (spec 06 v1.1 §B) |
| `contracts` | `ocr_confidence numeric(5,2) check between 0 and 100` | `ingest.ocr` stub (spec 21 §4.1) |
| `contracts` | `term_library_version text not null default 'v1.0'` | Which library produced the terms — never compare F1 across libraries (spec 22 §1) |
| `contracts` | **D46 — content hash:** `content_hash text check (null or ~ '^[0-9a-f]{64}$')` + `idx_contracts_user_hash (user_id, content_hash)` | sha-256 of the raw upload bytes; a same-user duplicate is reported as `duplicate_of` on the upload `201`, never rejected (spec 04 v1.1 §D; capability `versioning.duplicate_detect`, built) |
| `profiles` | `rollout_cohort text not null default 'none' check in ('none','internal','measurement','beta','ga')` | `rollout.cohorts` (spec 23 §5) |
| `chat_messages` | `enhanced_query text` | The query-enhancer rewrite, stored on the **user** row (spec 08 v1.1 §B) |
| `openai_calls` | `purpose` CHECK widened to `('extraction','chat','repair','summary','query_enhancer','risk','judge')` | New call purposes; the constraint is dropped and re-added by name |
| `processing_runs` | `stage` CHECK widened to `('upload','text_extract','ai_extract','summary','persist','risk','chat','crm_push','total')` — writers: `summary` (06 v1.1 §B), `chat` (08 v1.1 §A), `risk` (20 §3 route 19), `crm_push` (21 §5 route 27 / 06 step 11b, incl. the 501 path); component 3 (classify) shares `ai_extract` | Error rate per component 1–9 (spec 23 §3) |
| `rate_limits` | `bucket` CHECK widened to add `'risks'` | Spec 20 §3 |

### C. Functions, triggers, views and jobs added

| Object | Behaviour |
|---|---|
| `persist_key_terms(...)` **re-declared** (same signature) | Also inserts `reasoning`, `original_ai_reasoning = reasoning`, `original_ai_page = page_number`, `is_required`; each term row carries `term_library_version` and the function writes `contracts.term_library_version = max(t->>'term_library_version')`; sets `summary_status='pending'` so the summary step (spec 06 v1.1 §B) has a state to claim |
| `persist_risk_flags(p_contract_id, p_playbook_id, p_flags jsonb)` | Security invoker, granted to `authenticated`; deletes and re-inserts the contract's `risk_flags` in one statement, stamping `playbook_version` from the playbook row; raises `NOT_FOUND` for a non-owner (spec 20 §6.3) |
| `compute_hhh_verdicts()` trigger, BEFORE INSERT OR UPDATE on `hhh_scores` | Derives the three `*_verdict` columns from the 29 answers using the polarity table baked into the function (yes-is-failure: h1–h3, o1–o3, a1–a4; no-is-failure: the rest); NULL never fails |
| `compute_alert_metric(p_metric, p_window_days)` / `evaluate_alert_rules()` | Spec 23 §2.3 |
| `mark_due_reminders()` | Flips `reminders.status` scheduled → due where `send_at <= now()` |
| `risk_flag_corrections` view | `security_invoker`; flags with `was_wrong` (spec 20 §4.4) |
| `v_kpi_north_star_weekly`, `v_kpi_contracts_per_user_monthly`, `v_kpi_time_to_clarity`, `v_kpi_task_completion`, `v_kpi_hhh_weekly`, `v_kpi_cost_per_contract`, `v_kpi_correction_rate_weekly`, `v_error_rate_by_component`, `v_intent_resolution`, `v_content_safety_weekly`, `v_guardrail_false_positive_rate` | Spec 23 §4; all `security_invoker = true` |
| `set_updated_at` triggers | Attached to `playbooks`, `key_dates`, `hhh_scores`, `alert_rules` (every new table with `updated_at`) |
| pg_cron `evaluate-alert-rules` 02:00 UTC, `mark-due-reminders` 08:00 UTC | Pure SQL, always scheduled; the `send-due-reminders` invocation stays commented like `purge-expired-pdfs` (spec 21 §7.3) |
| Extension `vector` | `create extension if not exists vector with schema extensions;` — required by `contract_chunks.embedding` |

### D. RLS matrix additions

| Table | SELECT | INSERT | UPDATE | DELETE |
|---|---|---|---|---|
| `playbooks` | own **or `user_id is null`** | own | own | own |
| `playbook_rules` | own or `user_id is null` | own | — | own |
| `risk_flags` | own | own | own | — |
| `escalations` | own | own | — | — |
| `integration_connections` | own | **none** (service role) | **none** (service role) | own |
| `integration_events` | own | own | — | — |
| `key_dates` | own | own | own | own |
| `reminders` | own | own | own | own |
| `hhh_scores` | own | own **and `created_by = auth.uid()`** | own **and `created_by = auth.uid()`** — an owner cannot alter SME (`created_by = operator`) or judge rows on their contracts; those are service-role writes | — |
| `guardrail_events` | own | own | — | — |
| `alert_rules` | **none** | **none** | **none** | **none** |
| `alert_events` | **none** | **none** | **none** | **none** |
| `contract_chunks` | own | own | — | own |
| `eval_gates` | `true` (authenticated) | — | — | — |

The seeded playbook rows (`user_id IS NULL`) are inserted by the schema script itself (runs as `postgres`), which is why no INSERT policy needs to allow a NULL owner.

### E. Tests added to §8 (`tests/rls/placeholders.test.ts`)

11. For each of the 14 new tables: B cannot read, update or delete A's rows; B cannot insert rows carrying A's `user_id`.
12. Both A and B can read the seeded `playbooks`/`playbook_rules` rows (`user_id IS NULL`) and neither can update or delete them.
13. `alert_rules`, `alert_events`: A cannot select, insert, update or delete anything; `eval_gates`: A can select, cannot write.
14. `escalations`: A cannot update `status`; `guardrail_events`: A cannot update `false_positive`; `hhh_scores`: A cannot delete, and **A cannot update or insert a row whose `created_by` is not A** (an SME row on A's contract, inserted with the service role, is readable by A but immutable to A).
15. Cascades: deleting a `contracts` row removes its `risk_flags`, `escalations`, `integration_events`, `key_dates` (and their `reminders`), `hhh_scores`, `guardrail_events`, `contract_chunks`.
16. `persist_risk_flags` for B's contract raises `NOT_FOUND` and writes nothing; `risk_flags` insert with `severity='High', requires_human_review=false` violates the CHECK.
17. `compute_hhh_verdicts`: a client-supplied verdict is overwritten (spec 22 §13).
18. Verification queries: `28` tables; `rowsecurity = true` on all 28; `cron.job` lists `purge-expired-pdfs, reclaim-stale-processing, evaluate-alert-rules, mark-due-reminders`; `select extname from pg_extension where extname='vector'` returns one row.

**STATUS (2026-09-21): the complete file, v1.0 + v1.1 section, executed twice (idempotency) against `pgvector/pgvector:pg17` in Docker with a Supabase stand-in scaffold (roles, `auth.users`, `storage.*`, `cron.*` stubs, default grants).** Result (re-run after the round-1 review fixes): 28 tables, RLS on all 28, 67 policies, 13 views, `contract_chunks.embedding` of type `vector`, 4 cron jobs, 5 seeded rules, 6 alert rules; a functional smoke script exercised `persist_key_terms` (reasoning/originals/`summary_status='pending'`), cross-user denial, seed-playbook visibility and immutability, `alert_rules` denial, `compute_hhh_verdicts` polarity, the judge-fields and High-requires-review CHECKs, `escalations` non-closability, the hash CHECK, `mark_due_reminders()`, `evaluate_alert_rules()` firing once per 24 h, every view, and the contract-delete cascade. The only statements not exercised are the two `pg_cron`/`pg_net` `create extension` lines (Supabase-preloaded); `create extension vector` and the `vector(1536)` column ran for real.
