# 09 — Dashboard and Contract History

**Requirements:** US-008, FR-10; PRD §4 Flow 1 step 4, Flow 2; engineering-doc §4.1, §4.2, §5.3, §9.5, §10 v0.4.
**Acceptance:** dashboard shows contract name, type, date uploaded and review status; totals and NDA/MSA breakdown; last 5 contracts; a list sortable by date, name and type; clicking any row opens that contract's results.

---

## 1. Route `/dashboard`

Server Component + a client table island.

Server-side queries (user-scoped client; RLS enforces ownership):

```sql
-- (a) summary
SELECT count(*) AS total,
       count(*) FILTER (WHERE contract_type = 'NDA') AS nda,
       count(*) FILTER (WHERE contract_type = 'MSA') AS msa,
       count(*) FILTER (WHERE created_at >= date_trunc('month', now())) AS this_month
FROM contracts WHERE user_id = auth.uid();

-- (b) last 5
SELECT id, file_name, contract_type, status, created_at
FROM contracts WHERE user_id = auth.uid()
ORDER BY created_at DESC LIMIT 5;                      -- idx_contracts_user_created

-- (c) first page of the full list (50/page), sort applied server-side
```

---

## 2. Components

### `EmptyState` (zero contracts)
Exact copy: **"No contracts reviewed yet — upload your first contract to begin"** plus the primary CTA **"Review a Contract"** → `/contracts/new`. Rendered instead of the summary card and table.

### `SummaryCard`
Three figures: **Total contracts processed**, **NDA / MSA breakdown**, **This month**. Each is a labelled stat, not colour-coded. Above it, the prominent quick action **"Review a Contract"**.

### `RecentContractsList`
The last 5 contracts: file name, type badge, **status badge** and the upload date (`d MMM yyyy`, `date-fns`). Whole rows are links to `/contracts/{id}`.

Status badges:

| `status` | Label | Treatment |
|---|---|---|
| `uploaded` | "Not processed" | neutral; row links to `/contracts/{id}/prepare` |
| `processing` | "Analysing…" | neutral + subtle activity indicator |
| `completed` | "Reviewed" (or "Review complete" when `review_completed_at` is set) | success |
| `error` | "Failed" | error + a **"Retry"** action that calls `POST /api/contracts/{id}/process` **without re-uploading** |

### `ContractsTable`
Client island backed by `GET /api/contracts` through TanStack Query.

- Columns: File name · Type · Status · Uploaded · Pages · (row menu).
- **Sortable by `created_at`, `file_name`, `contract_type`** — clicking a header toggles `order` and updates the URL query string, so a sorted view is shareable and survives refresh. Sort state is announced via `aria-sort`.
- Pagination: 50 per page, with "Showing {a}–{b} of {total}".
- Optional filters: `type` (NDA/MSA) and `status`.
- Clicking any row opens `/contracts/{id}` (or `/prepare` when `status='uploaded'`). The row is a real link so middle-click and keyboard activation work.
- Row menu: **Open**, **Retry** (only when `status='error'`), **Delete** (spec 11).
- Loading → skeleton rows. Filtered-to-empty → "No contracts match these filters." — distinct copy from the zero-contracts empty state.

---

## 3. `GET /api/contracts`

Query params validated by `contractsQuerySchema`: `sort=created_at|file_name|contract_type` (default `created_at`), `order=asc|desc` (default `desc`), `page ≥ 1` (default 1), `page_size ≤ 50` (default 50), optional `type=NDA|MSA`, optional `status`. An invalid value → `400` with a field map.

Sort columns are mapped through an allow-list before reaching the query builder — the client string is never interpolated.

**Success `200`:**
```json
{ "contracts": [ { "id", "file_name", "contract_type", "status", "page_count",
                   "created_at", "review_completed_at" } ],
  "page": 1, "page_size": 50, "total": 42,
  "summary": { "total": 42, "nda": 25, "msa": 17 } }
```

Indexes serving this: `idx_contracts_user_created`, `idx_contracts_user_name`, `idx_contracts_user_type`, `idx_contracts_status`.

**CORRECTION (2026-09-20) — `page_size` is validated, not clamped.** An earlier
draft of §5 described `page_size` as "capped at 50", which implies silently
clamping an over-limit value and returning 50 rows. That contradicts spec 01 §7,
which defines the normative schema as
`page_size: coerce.number().int().min(1).max(50).default(50)` — a zod `.max()`
**rejects**. The explicit schema wins: `?page_size=500` returns
`400 VALIDATION` with `fields: { page_size: … }`, exactly as `?sort=contract_text`
does. Silently substituting a different value than the caller asked for would
also make the `total`/`page_size` pagination contract dishonest. Verified live.

---

## 4. Metrics this screen feeds

"Contracts processed per active user per month ≥ 4" is answered by the same `contracts` aggregation; 30-day retention comes from `activity_events` (`session_start`). No third-party analytics tracker is used — nothing about contract content leaves the project (spec 14).

Dashboard analytics **charts** (contracts by month, correction rate) are v1.1 and out of MVP scope; the data they need already exists in `contracts` and `term_corrections`.

---

## 5. Tests

- `tests/integration/contracts-list.test.ts` — each sort column and both orders; paging boundaries; `page_size` **above 50 is rejected** with `400 VALIDATION` and a field map (see the correction below); `type`/`status` filters; the `summary` counts match the rows; an invalid `sort` returns 400; another user's contracts never appear.
- `tests/e2e/dashboard.spec.ts` — a new user sees the exact empty-state copy; after one upload the summary reads 1 and the list shows the row; sorting by name reorders; clicking a row opens the results page; a contract in `error` shows Retry and retrying re-runs processing without re-uploading.
