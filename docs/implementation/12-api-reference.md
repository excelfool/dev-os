# 12 — API Reference (complete)

**Source:** engineering-doc §9 (all routes), §6.2 error handling.
Every route lives under `src/app/api/**/route.ts`, runs on the **Node runtime**, requires a valid Supabase session cookie unless marked public, re-verifies ownership in addition to RLS, and returns JSON.

**Common error envelope:**
```json
{ "error": { "code": "FILE_TOO_LARGE", "message": "This file is 14.2 MB — the limit is 10 MB.", "retryable": false } }
```
Validation failures add a `fields` map: `{ "error": { "code": "VALIDATION", "message": "…", "fields": { "message": "Required" } } }`.

**Available on every route:** `401 UNAUTHENTICATED`, `403 FORBIDDEN`, `404 NOT_FOUND`, `429 RATE_LIMITED` (with `Retry-After`), `500 INTERNAL`.

---

| # | Method + path | Auth | Rate limit | Spec |
|---|---|---|---|---|
| 1 | `POST /api/contracts/upload` | yes | 20/hr | 04 |
| 2 | `POST /api/contracts/{id}/custom-terms` | yes | — | 05 |
| 3 | `DELETE /api/contracts/{id}/custom-terms/{termId}` | yes | — | 05 |
| 4 | `POST /api/contracts/{id}/process` | yes | 10/hr + global 100 | 06 |
| 5 | `GET /api/contracts` | yes | — | 09 |
| 6 | `GET /api/contracts/{id}` | yes | — | 07 |
| 7 | `DELETE /api/contracts/{id}` | yes | — | 11 |
| 8 | `POST /api/contracts/{id}/signed-url` | yes | — | 07 |
| 9 | `PATCH /api/key-terms/{id}` | yes | — | 07 |
| 10 | `GET /api/contracts/{id}/chat` | yes | — | 08 |
| 11 | `POST /api/contracts/{id}/chat` | yes | 30/hr | 08 |
| 12 | `POST /api/contracts/{id}/complete` | yes | — | 10 |
| 13 | `POST /api/feedback` | yes | — | 10 |
| 14 | `POST /api/nps` | yes | — | 10 |
| 15 | `DELETE /api/account` | yes | — | 11 |
| 16 | `GET /api/contracts/{id}/export` (v1.1) | yes | — | 15 |
| 17 | `GET /api/health` | **public** | — | 14 |
| 18 | `GET /api/system-status` | yes (401 to anon) | — | 14 |

---

## 1. `POST /api/contracts/upload`
`multipart/form-data`: `file` (PDF), `contract_type` (`NDA|MSA`).
Order: session → rate limit → quota pre-check → size → magic bytes `%PDF-` → parseable → `numpages ≤ 20` → words ≥ 100 → tokens ≤ 15,000 → **consume one quota unit** (`consume_analysis_quota`, refunded on any later failure; never refunded when the contract is later deleted — spec 13 §5) → insert → best-effort Storage upload.
**201** `{ contract_id, page_count, token_estimate, storage_available, status: "uploaded" }`
**Errors** `400 NOT_A_PDF` · `413 FILE_TOO_LARGE` · `422 TOO_MANY_PAGES` · `422 TOO_MANY_TOKENS` · `422 SCANNED_PDF` · `422 CORRUPT_PDF` · `402 QUOTA_EXCEEDED`.
A Storage failure **never** fails this request — it returns 201 with `storage_available: false`.

## 2. `POST /api/contracts/{id}/custom-terms`
`{ "term_names": ["Non-compete radius"] }`, each 3–60 chars, deduped case-insensitively against standard and existing custom terms; total ≤ 5, enforced in the handler **and** by the DB trigger.
**201** `{ custom_terms: [{ id, term_name, is_manual: true }] }`
**Errors** `400 INVALID_TERM_NAME` · `409 DUPLICATE_TERM` · `422 CUSTOM_TERM_LIMIT` · `409 ALREADY_PROCESSED`.

## 3. `DELETE /api/contracts/{id}/custom-terms/{termId}`
**204.** **Errors** `409 ALREADY_PROCESSED` · `404 NOT_FOUND`.

## 4. `POST /api/contracts/{id}/process`
Body `{}`. GPT-4o, JSON mode, temp 0.1, `max_tokens` 2000, `user=<user_id>`, 20 s per-attempt timeout, up to 3 attempts + 1 JSON-repair retry, all inside a **24 s in-handler deadline** (spec 06 §3a) so the 26 s Netlify ceiling can never kill the run. Terms are persisted through the `persist_key_terms` RPC in a single transaction. A run stuck in `processing` for over 5 minutes is re-claimed by the next call and force-failed by the `reclaim-stale-processing` job.
**200** `{ contract_id, status: "completed", detected_type, type_mismatch_warning, term_count, first_term_ready_ms, terms[] }` where each term is `{ id, term_name, value, page_number, confidence_score, source_sentence, is_source_verified, is_custom, display_rank }`.
**Errors** `409 ALREADY_PROCESSING` (in flight) · `409 ALREADY_PROCESSED` (already completed — a successful extraction is not re-run) · `503 AI_UNAVAILABLE` · `504 AI_TIMEOUT` · `502 AI_INVALID_OUTPUT` · `429 RATE_LIMITED` · `503 CAPACITY`.
On any AI failure `contracts.status='error'` is persisted so the user retries **without re-uploading**, and **no partial `key_terms` rows are kept**.

## 5. `GET /api/contracts`
Query: `sort=created_at|file_name|contract_type`, `order=asc|desc`, `page≥1`, `page_size≤50`, `type?`, `status?`.
**200** `{ contracts[], page, page_size, total, summary: { total, nda, msa } }`.

## 6. `GET /api/contracts/{id}`
Touches `last_accessed_at` (the 90-day retention anchor).
**200** `{ contract: { …, storage_available, pdf_purged_at }, key_terms: [...], custom_terms: [...] }`.

## 7. `DELETE /api/contracts/{id}`
Removes the Storage object then the row; cascades everything else. **204.**

## 8. `POST /api/contracts/{id}/signed-url`
**200** `{ url, expires_in: 3600 }`. **404 NO_FILE** when `file_path IS NULL` — the client falls back silently to the text viewer.

## 9. `PATCH /api/key-terms/{id}`
`{ "value": "24 months" }`, 1–2,000 chars. Sets `value`, `is_edited=true`, `edited_at=now()`; `original_ai_value` is never modified.
**200** `{ id, value, is_edited: true, original_ai_value, edited_at }`, returned within the 2-second budget. **Errors** `400 INVALID_VALUE`.

## 10. `GET /api/contracts/{id}/chat`
Returns (creating if absent) the session and up to 200 messages ascending.
**200** `{ session_id, messages: [{ id, role, content, cited_pages, citation_verified, created_at }] }`.

## 11. `POST /api/contracts/{id}/chat`
`{ "message": "…" }`, 1–2,000 chars. Classify (no extra API call) → full contract text when the class needs it → full history (≤ 200, ascending) → GPT-4o temp 0.4, `max_tokens` 1000, 20 s, 3 retries → `[Page X]` validation with one repair retry → persist both messages.
**200** `{ user_message_id, assistant_message: { id, role, content, cited_pages, citation_verified, query_class, latency_ms } }`.
**Errors** `409 NOT_PROCESSED` · `503 AI_UNAVAILABLE` · `504 AI_TIMEOUT` (the question is preserved client-side for retry).

## 12. `POST /api/contracts/{id}/complete`
**200** `{ review_completed_at }`. Idempotent.

## 13. `POST /api/feedback`
`{ contract_id, rating: "up"|"down", comment?≤1000, survey_accuracy?: "yes"|"partially"|"no" }`. Upserts on `(user_id, contract_id)`. **201** the stored row.

## 14. `POST /api/nps`
`{ score: 0–10, comment?≤1000 }`. **201.** **409 ALREADY_SURVEYED** within 30 days.

## 15. `DELETE /api/account`
Sequence (spec 11 §3): purge every Storage object under `{user_id}/` → `admin.auth.admin.deleteUser(userId)` on the **service-role** client → the `auth.users → profiles → contracts → everything` cascade removes the rest. **No direct `profiles` DELETE is issued**: `profiles` has no DELETE policy (spec 02 §5), so a delete on the caller's JWT would affect zero rows and silently look like success. This is the deliberate resolution of the engineering doc's internal conflict between §9.15/§4.5 ("deletes the profile row") and §7.1 ("no client INSERT or DELETE — delete via cascade"); do not "restore" the §9.15 wording. **204**, followed by sign-out.

## 16. `GET /api/contracts/{id}/export` (v1.1)
Query `format=csv|pdf`. Streams within 5 s with `Content-Disposition: attachment`. CSV columns: `Term Name, Value, Page, Confidence, Edited, Source Sentence`.
**Plan access (A-16):** available on **Free Trial, Growth and Pro**; `403 PLAN_REQUIRED` only for a **Starter** user whose trial has ended.

## 17. `GET /api/health` (public)
Checks DB reachability. **200** `{ status: "ok", commit, db: "ok" }`; **503** when the DB check fails. Polled by Uptime Robot.

## 18. `GET /api/system-status`
Auth **required** (the `system_status` SELECT policy is `authenticated`-only). Excluded from the middleware matcher purely to skip a cookie refresh on the 60-second poll; the handler still re-checks the session and returns `401` to an anonymous caller. Anonymous visitors use the public status page instead (spec 14 §2b).
**200** `{ level: "none"|"p1"|"p0", message }`.
