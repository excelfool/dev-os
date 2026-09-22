# 14 — Observability, Telemetry, Cost Control and Incident Response

**Sources:** engineering-doc §1 success criteria, §6.2 (observability, incident response), §7.8–§7.10, §7.13, §8.5, §9.17, §9.18, Appendix B; PRD §3 metrics, §5 reliability, §11 Reliability & Safety.
**Principle:** every metric the PRD names is computed from first-party data in Postgres. No third-party analytics vendor touches contract data, and the architecture adds **no paid vendor beyond Supabase, OpenAI and Uptime Robot** (~$355/month at 500 active users).

---

## 1. `GET /api/health` (public)

```ts
// Runs `select 1` against Postgres with a 2s timeout.
// 200 { status: "ok", commit: BUILD_COMMIT (captured at build from Netlify COMMIT_REF ?? COMMIT_SHA; never process.env at request time), db: "ok" }
// 503 { status: "degraded", commit, db: "error" }
```
No auth, no user data, no caching (`Cache-Control: no-store`). Polled by **Uptime Robot** at 1-minute intervals with alerts to the team Slack channel — the evidence for the 99.5% uptime SLA.

---

## 2. `GET /api/system-status` and the incident banner

Returns the single `system_status` row: `{ level: 'none'|'p1'|'p0', message }`. **Authenticated only** — `system_status` grants SELECT to `authenticated` and no anon policy exists, so the banner is an in-app surface for signed-in users; anonymous visitors are served by the public status page (§2b) instead. `SystemStatusBanner` (in the authed shell) polls every 60 s and renders a full-width banner when `level !== 'none'` — red for `p0`, amber for `p1` — with the operator's message. The row is written with the service role, so a banner can be raised **without a deploy**.

### 2a. Outbound email — `send-notification` Edge Function

Two obligations in the sources require outbound email: the **P0 incident email to all affected users within 1 hour** (PRD §11) and the **account-deletion confirmation** (engineering-doc §4.5, §9.15). Both are served by one Supabase Edge Function, `supabase/functions/send-notification/`, so **no new paid vendor is added** (the operating budget allows only Supabase, OpenAI and Uptime Robot).

- **Transport:** the project's configured SMTP credentials — `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM` (all SERVER ONLY, in `.env.example` and in the Supabase Function secrets). The same SMTP configuration backs Supabase Auth's own emails, so there is one mail identity to manage.
- **Interface:** `POST /functions/v1/send-notification` with a service-role Bearer token and `{ template: 'account_deleted' | 'incident_p0', to: string[], vars: Record<string,string> }`. It rejects any request without the service-role token, batches recipients 50 at a time, and returns `{ sent, failed }`.
- **Templates:** `account_deleted` (spec 11 §3) and `incident_p0` (subject "ContractIQ service incident", body = the operator's `system_status.message` plus the status-page link).
- **Callers:** `DELETE /api/account` (best effort, non-blocking) and the **operator** during a P0, via `scripts/notify-incident.ts`, which selects the affected users' emails from `profiles` and invokes the function. Sending is an explicit operator action, never automatic — the operator decides who is affected.
- **Privacy:** emails never contain contract content, term values or chat text.

### 2b. Public status page

The public status page is the **Uptime Robot public status page** attached to the `/api/health` monitor — the same vendor already in the budget, hosted off ContractIQ's own infrastructure so it stays up when the app does not. Its URL is read from `publicConfig.statusPageUrl` (backed by `NEXT_PUBLIC_STATUS_PAGE_URL`; spec 01 §1 — components never read `process.env` directly), is linked from the footer and from the in-app incident banner (which hide the link when the value is empty), and is included in the `incident_p0` email. The operator updates it **within 30 minutes** of a P0 (runbook step 2 below). There is no in-app `/status` route: a status page served by the application cannot report a full application outage.

**Operator incident runbook (P0):**
1. Set `system_status` to `level='p0'` with the user-facing message (≤ 5 min) — the in-app banner appears with no deploy.
2. Update the Uptime Robot status page (≤ 30 min).
3. Run `scripts/notify-incident.ts` to send `incident_p0` to affected users (≤ 1 h).
4. On resolution, set `level='none'`, clear the message, and post the resolution to the status page.

**Incident response (PRD §11):**
- **P0** (data exposure or full outage): set `level='p0'` with the message, email every affected user within **1 hour**, update the public status page within **30 minutes**.
- **P1** (degraded performance): set `level='p1'` within **2 hours**.
- Supabase downtime: the banner plus the app's error states cover it; no data loss risk because every multi-row write is a single transaction.

---

## 3. Telemetry tables and the metric each one answers

| Metric (PRD/eng-doc) | Target | Query |
|---|---|---|
| End-to-end extraction latency | ≤ 30 s P95 (≤ 45 s in beta) | `percentile_disc(0.95) WITHIN GROUP (ORDER BY duration_ms) FROM processing_runs WHERE stage='total'` |
| Time to first extracted key-term display | ≤ 30 s P95 | `percentile_disc(0.95) … FROM contracts.first_term_ready_ms` |
| Chat response latency | ≤ 15 s P95 | `percentile_disc(0.95) … FROM chat_messages.latency_ms WHERE role='assistant'` |
| Single OpenAI call latency | ≤ 20 s P95 | `openai_calls.latency_ms` |
| Cost per analysis | ≤ $0.25 total, ≤ $0.20 extraction | `SUM(cost_usd) GROUP BY contract_id`; extraction-only filters `purpose='extraction'` |
| Monthly OpenAI spend | alert at 80% of `OPENAI_MONTHLY_BUDGET_USD` | `SUM(cost_usd) WHERE created_at >= date_trunc('month', now())` |
| Correction rate | ≤ 12% (≤ 20% beta), 7-day rolling | `count(term_corrections) / count(key_terms)` over the window |
| Inline edit save | ≤ 2 s | `activity_events WHERE event_type='term_edited'` |
| Export generation | ≤ 5 s | `activity_events WHERE event_type='export_generated'` |
| Auth flow | ≤ 10 s | `activity_events WHERE event_type='auth_complete'` |
| North Star: upload → review complete | ≤ 15 min | `review_completed_at - created_at`, falling back to `MAX(activity_events.created_at)` per contract |
| 30-day retention | ≥ 45% | Cohort query on `activity_events.event_type='session_start'` |
| Contracts per active user per month | ≥ 4 | `contracts` grouped by `user_id` and month |
| NPS | ≥ 40 | %(score 9–10) − %(score 0–6) from `nps_responses` |
| Uptime | 99.5% | Uptime Robot on `/api/health` |

**`activity_events.event_type` is a closed vocabulary — this table is its single source.** No other spec may introduce a value without adding it here.

| `event_type` | Written by |
|---|---|
| `session_start` | Authed shell, first page load of a browser session (spec 03 §12) |
| `auth_complete` | Sign-up / sign-in success, with the measured duration (spec 03 §12) |
| `upload_start` / `upload_complete` | `POST /api/contracts/upload` (spec 04 §2 step 10) |
| `process_started` | `POST /api/contracts/{id}/process`, at step 5 when `status` flips to `processing` (spec 06 §3) |
| `results_viewed` | Results page mount (spec 07 §1) |
| `term_edited` | `InlineTermEditor` after a successful PATCH, with the measured duration (spec 07 §5) |
| `chat_message_sent` | `POST /api/contracts/{id}/chat` step 11; metadata carries `query_class` and latency only (spec 08 §3) |
| `review_completed` | `POST /api/contracts/{id}/complete` (spec 10 §1) |
| `export_generated` | Export route, with the measured duration (spec 15 §1) |
| `pdf_render_failed` | `PdfViewer` fallback path; metadata carries the page index and error name only (spec 07 §2) |
| `onboarding_tip_dismissed` | Onboarding tooltips, once per tip (spec 16 §5); metadata is `{ tip_id: 'upload' \| 'confidence' \| 'chat' }` — a short key that passes the `events.ts` guard in spec 01 §5, which rejects only the keys `content`, `text`, `value`, `source_sentence` and any string over 200 characters |

---

## 4. Scheduled monitoring jobs

| Cadence | Job | Action |
|---|---|---|
| Daily 04:00 UTC | Cost rollup | Sum `openai_calls.cost_usd` for the month; Slack alert at **80% of the OpenAI budget**; flag any single `contract_id` whose total exceeds **$0.25** |
| Weekly | Storage check | Compare bucket usage against the Supabase allowance; alert at **70%** |
| Weekly | Drift check | Sample 10 recent user-corrected terms and compare against expected extraction |
| Daily | Correction-rate check | 7-day rolling rate > 12% → automatic prompt-review alert |
| Nightly 03:00 UTC | `purge-expired-pdfs` | Spec 11 |
| Nightly 03:30 UTC (**beta only**) | **Low-confidence invariant job** — the automated half of the Measurement Beta "0 incidents of misleading output without a confidence warning" gate (spec 18 §4) | Runs `low-confidence-invariant` over **every** beta contract, not a sample: `SELECT kt.id, kt.contract_id, kt.confidence_score FROM key_terms kt WHERE kt.confidence_score < 50` (served by `idx_key_terms_low_conf`), joins each row to a rendering assertion that the row is present in the panel payload **with** the ⚠️ icon and the non-dismissible tooltip, and writes the result to `eval/reports/low-confidence-invariant-<date>.json`. **Any** row that renders without the warning, or is absent from the payload, is a hard failure: Slack alert plus a blocking entry on the beta gate |
| Every 5 minutes | `reclaim-stale-processing` (pg_cron) | Flips `contracts` rows stuck in `status='processing'` for > 5 minutes to `status='error'` with `error_code='AI_TIMEOUT'`, so a killed function can never strand a user (spec 06 §3a) |
| Monthly | Calibration run | Spec 17; error ≥ 0.15 → set `CALIBRATION_WARNING_ACTIVE=true` so `CalibrationNotice` renders on every results page until it clears |
| Monthly | Legal-SME audit | 5 random production contracts, exported by an operator from `feedback_opt_in = true` rows only |

Alerts post to `SLACK_ALERT_WEBHOOK_URL`. Alert payloads carry metric names and numbers only — never contract content.

---

## 5. Other observability surfaces

Netlify function logs (structured JSON lines), the Supabase dashboard (DB and Storage metrics), and the OpenAI usage dashboard (token consumption and error rates) complete the picture alongside the in-DB telemetry above.

---

## 6. Tests

- `tests/integration/health.test.ts` — 200 with `commit` and `db: "ok"`; 503 when the DB check fails; the route is reachable without a session.
- `tests/integration/system-status.test.ts` — returns the current row for a signed-in user; an **anonymous** request returns `401`; an authenticated user cannot update the row.
- `tests/integration/send-notification.test.ts` — the function rejects a request without the service-role token; `account_deleted` and `incident_p0` render their templates; a recipient batch failure is reported in `failed` without throwing; no template body contains contract or chat content.
- `tests/unit/cost.test.ts` — `computeCostUsd(15000, 1500)` ≈ `0.0975`; rounding to 6 decimals; a 20-page analysis stays under $0.25.
- `tests/unit/events.test.ts` — `recordEvent` rejects metadata containing a `content`/`text`/`value`/`source_sentence` key or any string longer than 200 characters.
- `tests/integration/telemetry.test.ts` — a successful process writes `processing_runs` rows for `ai_extract`, `persist` and `total`, and one `openai_calls` row per attempt including failed attempts.

---

## v1.1 amendments (PRD v1.1, 2026-09-21 — §11 Observability R-30, US-017, §3 KPI tree)

### A. Observability mapping

The PRD §11 Observability table is mapped measure-by-measure in **spec 23 §3**; the KPI tree (North Star → L1 → L1B → L2) is implemented as the SQL views in **spec 23 §4**. §3 above keeps every existing query; the North Star row is **re-labelled**: "North Star" is now *contracts processed with review completed, WoW* (`v_kpi_north_star_weekly`), and the ≤ 15 min "upload → review complete" row becomes **L1 time-to-clarity** (`v_kpi_time_to_clarity`). The task-completion funnel (≥ 85%) is `v_kpi_task_completion`; the HHH percentages are `v_kpi_hhh_weekly`.

### B. `activity_events.event_type` vocabulary additions (§3 is still the single source)

| `event_type` | Written by |
|---|---|
| `summary_generated` / `summary_deferred` | `/process` step 11a (spec 06 v1.1 §B); metadata: duration only |
| `key_date_unparsed` | `reminder-service.deriveKeyDates` (spec 21 §7.2); metadata `{ kind }` |
| `hhh_scored` | `PUT /api/hhh-scores` (spec 22 §4); metadata `{ subject_type }` |
| `push_attempted` | route 27 (spec 21 §5); metadata `{ target, status }` |
| `capabilities_viewed` | `/settings#capabilities` mount (spec 21 §3) |

`chat_message_sent` metadata gains `unresolved_turns`, `enhanced: boolean` and `greeting: boolean` (spec 08 v1.1 §A step 5b); `term_edited` gains `field`.

### C. `send-notification` templates (§2a)

Template union becomes `'account_deleted' | 'incident_p0' | 'key_date_reminder' | 'alert_fired'`. `key_date_reminder` (spec 21 §7.3) carries the contract file name, the key-date kind label, the date, the term name and a link — no other term values. `alert_fired` (spec 23 §2.3) carries the rule description, metric value and threshold to `ALERT_EMAIL_TO`. The `send-due-reminders` Edge Function is a second caller (written, undeployed).

### D. Scheduled jobs (§4) — additions

| Cadence | Job | Action |
|---|---|---|
| Daily 02:00 UTC (pg_cron) | `evaluate-alert-rules` | `select public.evaluate_alert_rules()` → `alert_events` (spec 23 §2.3). The 80%-budget and 12%-correction alerts above are now rows in `alert_rules`; the daily rollup delivers undelivered events |
| Daily 08:00 UTC (pg_cron) | `mark-due-reminders` | `select public.mark_due_reminders()` (spec 21 §7.3) |
| Daily 08:05 UTC (**undeployed**, cron line commented) | `send-due-reminders` Edge Function | Emails due reminders via `send-notification` |
| Weekly Monday 06:00 UTC (CI) | `sample-week.ts` | Spec 22 §7 — publishes the week's HHH sample and the human/judge split |
| Weekly (extends the drift check) | Human-vs-judge drift | Disagreement rate per pillar on the overlap; alert > 30% |
| Every deploy | `redteam.ts` | `harmless.redteam_pass_rate` (spec 22 §9) |

### E. Health monitoring surfaces (§5)

Add `guardrail_events`, `alert_rules`/`alert_events`, `eval_gates` and the `v_kpi_*` views; `scripts/daily-ops.ts` prints the one-screen daily health check (spec 23 §6).

### F. Tests added

- `tests/integration/send-notification.test.ts` — `key_date_reminder` and `alert_fired` render; neither contains term values other than the date.
- `tests/unit/events.test.ts` — the new event types are accepted; `unresolved_turns` metadata passes the guard.
