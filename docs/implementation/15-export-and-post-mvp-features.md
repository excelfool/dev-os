# 15 — Export (v1.1) and Post-MVP Feature Specs

**Requirements:** US-011 (P2, 4 pts), PRD §3 roadmap v1.1 and v1.2, §12 pricing tiers; engineering-doc §9.16, §10 Phase 2 and Phase 3, A-08, A-16.
**Status:** everything in this file is **outside MVP (v0.1–v1.0)**. It is specified now so the MVP code does not paint it into a corner. Ship it behind `NEXT_PUBLIC_EXPORT_ENABLED` (default `false`).

Note on the PRD's ID collision (A-08): `US-011` names two distinct items. **"US-011-partial" — the key-terms panel — is P0 and ships in v0.2** (spec 06/07). **US-011 — export — is P2 and ships in v1.1**, below. Neither is dropped.

---

## 1. `GET /api/contracts/{id}/export`

Query: `format=csv|pdf`. Auth + ownership required. Contract `status` must be `'completed'` → else `409 NOT_PROCESSED`.

**Plan access (A-16):** available to **Free Trial** (the trial includes full features), **Growth** and **Pro**. `403 PLAN_REQUIRED` is returned **only** for a Starter-plan user whose trial has ended. The rule lives in a single config map, `EXPORT_ALLOWED_PLANS = ['free_trial','growth','pro']`, so pricing changes are a one-line edit — PRD Assumption 12 marks pricing as directional.

**Response:** `200` with `Content-Disposition: attachment; filename="{sanitised_file_name}-key-terms.{csv|pdf}"`, generated and streamed **within 5 seconds**.

### CSV
`text/csv; charset=utf-8`, UTF-8 BOM for Excel. Columns, in this exact order (engineering-doc §9.16):
`Term Name, Value, Page, Confidence, Edited, Source Sentence`
- `Value` — the current value, or `Not found in document` when null.
- `Page` — the integer, or empty when null.
- `Confidence` — `92%`.
- `Edited` — `Yes` / `No`.
- Rows ordered by `display_rank, term_name`. Fields are RFC 4180 quoted; a leading `=`, `+`, `-` or `@` is prefixed with `'` to prevent spreadsheet formula injection.

### PDF summary
A branded one-to-two-page summary: contract file name, type, upload date, page count; a table of terms with value, page and confidence (colour band plus the icon/text so it is not colour-only); the "Why?" source sentence in a smaller second line; and the **not-legal-advice disclaimer** plus the "Powered by OpenAI GPT-4o" attribution in the footer. Generated server-side with `pdf-lib` (no headless browser on the request path).

Client: `ExportButton` on the results page with a format menu; on success it records `activity_events` `export_generated` with the measured duration (evidence for the ≤ 5 s target).

---

## 2. Remaining v1.1 items (specified, not built at MVP)

| Item | Contract |
|---|---|
| **Batch upload (≤ 5 contracts)** | The dropzone accepts up to 5 files; each becomes an independent `contracts` row; processing runs **sequentially** through the same `/process` route and the same concurrency guard; per-file status is visible in a queue list; the quota is checked per file, and a quota rejection mid-queue stops the remainder with a clear message. |
| **Dashboard analytics charts** | Recharts. "Contracts by month" from `contracts.created_at`; "Term correction rate" from `term_corrections ÷ key_terms` by month. Both are user-scoped. |
| **Public trust page `/trust`** | Static page publishing the latest F1 (NDA and MSA) and calibration results from `eval/reports/`, plus the stated model limitations verbatim. |

---

## 3. v1.2 items (specified, not built)

| Item | Contract |
|---|---|
| **Scanned-PDF support (OCR)** | Files failing the `< 100 words` check are routed to OCR (AWS Textract or equivalent) instead of being rejected; OCR output enters the **same** `[PAGE N]` pipeline, so nothing downstream changes. Requires a new vendor DPA before EU use. |
| **Contract comparison view** | Side-by-side key terms for two contracts **of the same type**, aligned by `term_name`, with differences highlighted. |
| **Email notification on completion** | Sent on `status='completed'` when processing exceeded a threshold; delivered by an Edge Function, not the request path. |
| **Multi-user team workspace** | Introduces the first role split: workspace membership and roles; RLS extends from owner-only to membership-based; the Pro tier's 5 seats. Requires a schema migration and a re-run of the full RLS suite. |
| **Non-US few-shot examples + jurisdiction audit** | New examples in prompt `v2.0`; the monthly audit reports F1 segmented by jurisdiction and industry, addressing the stated fairness gap (CUAD's US bias). |

---

## 4. Explicitly out of scope at MVP

Scanned/image PDFs and OCR; non-English contracts and non-US/UK governing law; contract types other than NDA and MSA; contracts over 20 pages / 15,000 tokens; chunked or vector RAG; a fine-tuned extraction model; multi-user workspaces, seats and API access; a native desktop app; batch upload, comparison and email notifications; **and payment collection / subscription billing** (A-06 — the MVP ships plan state and quota enforcement only, with plans set by an operator).

---

## 5. Tests (when built)

- `tests/integration/export.test.ts` — CSV has exactly the six columns in order; `Not found in document` renders for null values; formula-injection prefixes are applied; generation completes in **under 5 s** for a 30-term contract; `403 PLAN_REQUIRED` for a Starter user past their trial; **200** for `free_trial`, `growth` and `pro`; `409 NOT_PROCESSED` before extraction.
- `tests/e2e/export.spec.ts` — the download lands in the browser with the right filename.
