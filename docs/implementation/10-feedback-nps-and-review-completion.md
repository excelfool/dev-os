# 10 — Feedback, NPS and Review Completion

**Requirements:** US-010, FR-12; PRD §3 metrics (NPS ≥ 40, North Star), §4 Agent Capabilities "Feedback Logger", §10 eval (beta satisfaction survey), §11 launch criteria; engineering-doc §4.3 (complete/feedback block), §9.11–§9.13, §7.7, §7.11.

---

## 1. `CompleteReviewButton` — closing the North Star timer

The North Star metric is "time from contract upload to completed key-term review", target ≤ 15 minutes against a 90-minute baseline. It is measured as `contracts.created_at → contracts.review_completed_at`; when the user never marks completion, the fallback is `MAX(activity_events.created_at)` for that contract.

- Placement: results page, at the foot of the key-terms panel, labelled **"Mark review complete"**.
- `POST /api/contracts/{id}/complete` → `UPDATE contracts SET review_completed_at = now()` (idempotent: a second call leaves the first timestamp unchanged and still returns 200).
- **Success `200`:** `{ "review_completed_at": "2026-09-20T10:31:04.221Z" }`
- On success: a confirmation toast "Review marked complete", the button becomes a "Review complete · {date}" state, the dashboard status badge changes, and `activity_events` `review_completed` is written with the elapsed ms since `created_at`.
- Marking complete does **not** lock the contract — editing, chatting and export all remain available.

---

## 2. `FeedbackWidget` (US-010, FR-12)

Rendered on the results page, below the terms panel and beside the complete button.

- **👍 / 👎** toggle buttons with accessible names "This review was accurate" / "This review was not accurate".
- An **optional** comment textarea (≤ 1,000 chars) revealed after a rating is chosen, placeholder "Anything we got wrong? (optional)".
- The beta satisfaction question, shown while the beta flag is on: **"Were the extracted terms accurate?"** with options **Yes / Partially / No** → `survey_accuracy`. This is the field the ≥ 75% (beta) and ≥ 80% (launch) satisfaction gates query.
- Submit posts to `POST /api/feedback`; the widget then shows "Thanks — this helps us improve." and remains editable (the row is upserted).

### `POST /api/feedback`
Request: `{ "contract_id": "uuid", "rating": "up"|"down", "comment"?: string(≤1000), "survey_accuracy"?: "yes"|"partially"|"no" }`.
- Ownership of `contract_id` verified.
- **Upsert on `(user_id, contract_id)`** — one rating per review, updatable.
- `contract_type` is copied from the contract at write time so feedback can be segmented by type without a join (PRD §11 Fairness).
- **Success `201`:** the stored row. Errors: `400` validation, `404 NOT_FOUND`.

Fully autonomous logger — no AI, no moderation, no side effects beyond the row (PRD §4 Agent Capabilities).

---

## 3. `NpsSurvey`

- Trigger: **at session end**, at most **once per user per 30 days**. "Session end" is implemented as either (a) the user marks a review complete, or (b) 15 minutes of inactivity on an authed page, whichever comes first — and only when `nps_responses` has no row for this user within 30 days.
- UI: a dismissible card asking "How likely are you to recommend ContractIQ to a colleague?" with a 0–10 scale (each value a focusable button, keyboard arrow-navigable) and an optional comment.
- Dismissing counts as declining and suppresses the prompt for 30 days via a local flag; it does **not** write a row.

### `POST /api/nps`
Request `{ "score": 0–10, "comment"?: string(≤1000) }`. The service checks `nps_responses` for a row by this user within 30 days → `409 ALREADY_SURVEYED`. **Success `201`.**

NPS = %promoters (9–10) − %detractors (0–6), target ≥ 40.

---

## 4. Feedback opt-in and the improvement loop (A-12)

- `profiles.feedback_opt_in` (default **false**) is toggled on `/settings`.
- **Every** term edit is stored regardless of the flag — it is the user's own record and the input to the ≤ 12% correction-rate metric, owner-only under RLS.
- Only rows whose owner has `feedback_opt_in = true` are exported from `term_corrections`, **stripped of identifiers** (`user_id`, `contract_id` removed; term name, original value, corrected value, confidence, contract type and prompt version retained), for prompt improvement.
- The export is an operator action using the service role, not an in-app feature.

---

## 5. Alerts driven by this data

- **Correction rate**: `count(term_corrections rows) / count(key_terms)` over a 7-day rolling window. Above **12%** → automatic prompt-review alert to Slack. The beta gate is ≤ 20%; the launch gate ≤ 12%.
- **Satisfaction**: `count(*) FILTER (WHERE survey_accuracy='yes') / count(*) FROM user_feedback WHERE survey_accuracy IS NOT NULL` — ≥ 0.75 at the beta gate, ≥ 0.80 at launch.

---

## 6. Tests

- `tests/integration/feedback.test.ts` — insert then update upserts a single row; `contract_type` is denormalised correctly; a comment over 1,000 chars is rejected; another user's `contract_id` returns 404.
- `tests/integration/nps.test.ts` — the first submission returns 201; a second within 30 days returns `409 ALREADY_SURVEYED`; a submission 31 days later succeeds; scores −1 and 11 are rejected.
- `tests/integration/complete.test.ts` — sets `review_completed_at`; a repeat call is idempotent and preserves the original timestamp.
- `tests/unit/feedback-widget.test.tsx` — the comment field appears only after a rating; the three survey options map to the right values; submit is disabled without a rating.
- `tests/e2e/contract-review.spec.ts` — marking review complete updates the dashboard badge; submitting 👍 persists across reload.
