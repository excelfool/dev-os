# 11 — Retention, Deletion and GDPR Erasure

**Requirements:** PRD §5 (data retention, GDPR-ready), §11 Accountability ("how is sensitive data managed"), Assumption 13; engineering-doc §4.5, §9.14, §9.15, §10 v1.0 "Retention & deletion", A-10.

---

## 1. Manual contract deletion

**Entry points:** the dashboard row menu and the results page overflow menu.

**Confirmation modal** — names exactly what is removed, so consent is informed:
> "Delete "{file_name}"? This permanently removes the PDF, the extracted text, all key terms, your chat history and any feedback for this contract. This cannot be undone."
Actions: Cancel (focused by default) and **Delete** (destructive styling). Focus is trapped in the modal and returned to the trigger on close.

### `DELETE /api/contracts/{id}`
1. Session + ownership verified.
2. If `file_path` is not null, remove the Storage object. A Storage failure here is **logged and ignored** — it must not block the DB deletion, and the nightly job will sweep orphans.
3. `DELETE FROM contracts WHERE id = $1 AND user_id = auth.uid()`.
4. `ON DELETE CASCADE` removes `key_terms`, `custom_key_terms`, `chat_sessions`, `chat_messages`, `user_feedback`, `processing_runs` and `openai_calls`.
5. **Success `204`.** The row disappears from the list (optimistic removal, rollback on failure) and a toast reads "Contract and all associated data deleted."

Errors: `404 NOT_FOUND` (including another user's id — never disclose existence), `401`.

---

## 2. Nightly 90-day PDF purge

**Trigger:** Supabase `pg_cron`, `0 3 * * *` (03:00 UTC), invoking the Edge Function `purge-expired-pdfs`. Per A-02, Edge Functions are used **only for scheduled/background jobs** — this one and `send-notification` (spec 14 §2a); every request/response API is a Next.js Route Handler.

**`supabase/functions/purge-expired-pdfs/index.ts`** (Deno, service-role client):

```ts
// 1. Select the batch
//    select id, user_id, file_path from contracts
//    where file_path is not null
//      and last_accessed_at < now() - interval '90 days'   // PDF_RETENTION_DAYS
//    order by last_accessed_at asc limit 500;              // idx_contracts_retention
// 2. For each row: storage.from('contracts').remove([file_path])
//    - success or "object not found" -> proceed
//    - other error -> skip this row, leave file_path intact, count as failed
// 3. update contracts set file_path = null, pdf_purged_at = now() where id = $1
// 4. Repeat until the batch returns fewer than 500 rows or 10 batches have run
// 5. Prune rate_limits rows with window_start < now() - interval '7 days'
// 6. Return { scanned, purged, failed } and log one structured line
```

**What is preserved:** the `contracts` row, `contract_text`, `key_terms`, `custom_key_terms` and the whole chat history. They are the user's review record — the PRD never asks for them to be destroyed (A-10). Only the stored PDF goes.

**What the user sees afterwards:** the results page automatically serves the text viewer with the note "The original PDF was removed after 90 days of inactivity." — identical rendering behaviour to the Storage-unavailable path, because both are `file_path IS NULL`.

**The clock:** `contracts.last_accessed_at`, touched on every `GET /api/contracts/{id}` (i.e. every results-page view). Viewing a contract therefore restarts its 90-day window.

**Authentication of the job:** the cron call sends the service-role key from Supabase Vault as a Bearer token; the function rejects any request without it.

---

## 3. Account deletion (GDPR erasure)

**Entry point:** `/settings` → Danger zone → **"Delete my account and all data"**. A confirmation dialog requires the user to type the word `DELETE` before the destructive button enables, and lists what is removed: every contract, PDF, extracted text, key term, chat message, feedback entry and the account itself.

### `DELETE /api/account`
1. Session verified; the user id is taken from the session, never from the body.
2. List and remove **every** Storage object under `{user_id}/` in the `contracts` bucket, paging until the prefix is empty. Failures are retried once, then logged.
3. **Skip a direct `profiles` delete.** `profiles` has no DELETE policy (spec 02 §5), so a delete on the caller's JWT would affect zero rows and silently "succeed". Erasure of the profile row and everything keyed to it happens through the documented `profiles.id → auth.users(id) ON DELETE CASCADE` chain, triggered by step 4. (If a future change makes an explicit delete necessary, it must run on the **service-role admin client**, not the caller's.)
4. Delete the auth user via `admin.auth.admin.deleteUser(userId)` using the **service-role** client (one of the sanctioned service-role call sites listed in spec 13 §2). This cascades `auth.users → profiles → contracts → key_terms / custom_key_terms / chat_sessions / chat_messages / user_feedback / processing_runs / openai_calls / activity_events / nps_responses / rate_limits`.
5. **Success `204`.** The client signs out and routes to `/` with a confirmation banner. A confirmation email is sent.
6. Completed **within the request** — no manual ops step.

**Confirmation email.** The address is captured *before* step 3 (the profile row is about to be deleted) and passed to the `send-notification` Edge Function (spec 14 §2a) with template `account_deleted`. The email send is **best effort and non-blocking**: a failure is logged and does not fail the erasure, because the deletion itself is the legal obligation. Copy: "Your ContractIQ account and all associated data have been permanently deleted. Nothing further is required from you."

Errors: `401`; `500 INTERNAL` if the auth-user deletion fails (the Storage objects are already gone but the rows remain — logged with the user id for operator follow-up and retried on the user's next attempt, which is safe because every step is idempotent).

### 3a. Implementation note — the Storage orphan is confirmed, not theoretical

**Verified live during Slice 3 (2026-09-20).** Deleting an auth user via
`admin.auth.admin.deleteUser(userId)` cascaded every DB row for that user
(`profiles`, `contracts`, `processing_runs`, `activity_events`, `rate_limits`)
down to zero — but left **5 Storage objects intact** under `{user_id}/` in the
`contracts` bucket. The `ON DELETE CASCADE` chain is a Postgres foreign-key
chain; `storage.objects` rows are not reachable from it.

Consequence for the implementation: **step 2 of §3 above is load-bearing and
must run before step 4, not after.** If the auth user is deleted first, the
caller's JWT is gone, RLS-scoped Storage deletion is no longer possible, and the
objects can only be removed with the service role by an operator — a GDPR
erasure that silently leaves the user's PDFs on disk. Purge the prefix, page
until it is empty, *then* delete the auth user.

---

## 4. What the privacy page must state

Mirrors §1–§3 exactly (spec 03 §5): 90-day PDF retention post last access; text and terms retained as the review record until deleted by the user; deletion available at any time for a single contract or the whole account; encryption at rest (AES-256) and in transit (TLS 1.3); no contract content used to train any model; Article 28 DPAs with Supabase and OpenAI before EU onboarding.

---

## 5. Tests

- `tests/integration/retention.test.ts` — **90-day boundary:** a contract last accessed 89 days ago is untouched; 91 days ago is purged (`file_path` null, `pdf_purged_at` set) while its `key_terms` and `chat_messages` rows remain; a contract with `file_path` already null is skipped; a Storage removal error leaves `file_path` intact and counts as failed.
- `tests/integration/last-accessed.test.ts` — `GET /api/contracts/{id}` advances `last_accessed_at`.
- `tests/integration/delete-contract.test.ts` — 204; every cascaded table is empty for that contract; a Storage failure still deletes the row; another user's id returns 404.
- `tests/integration/delete-account.test.ts` — asserts the `profiles` row is gone **because of the `auth.users` cascade** (the test deletes only the auth user and checks the chain), not incidentally; the confirmation email is dispatched with the pre-deletion address and a send failure still returns 204; all Storage objects under the prefix are gone; every table has zero rows for the user; the auth user no longer exists; the session is invalid afterwards.
- `tests/e2e/deletion.spec.ts` — deleting a contract from the dashboard removes the row and the toast appears; the results page for that id then 404s.

---

## v1.1 amendments (PRD v1.1, 2026-09-21)

- **Contract deletion (§1) and account erasure (§3)** cascade through the 14 v1.1 tables as well (`integration_connections` via `profiles`, with its Vault secret removed by `DELETE /api/account` as one more cleanup step before `deleteUser`): `risk_flags`, `escalations`, `integration_events`, `key_dates` → `reminders`, `hhh_scores`, `guardrail_events`, `contract_chunks` via `contracts`; `playbooks` → `playbook_rules` via `profiles`. The seeded default playbook (`user_id IS NULL`) is never deleted by a user erasure. `tests/rls/placeholders.test.ts` item 15 (spec 02 v1.1 §E) is the cascade test.
- **Data minimisation:** `guardrail_events` and `integration_events` store hashes only; `hhh_scores` stores answers and notes, never contract text. Exports (`eval/export/*`) include contract text only for eval datasets or `feedback_opt_in = true` owners (spec 22 §5, §10).
- **Summary** (`contracts.summary_md`) is contract-derived content and is deleted with the contract; it is never sent to a third party other than OpenAI at generation time.
