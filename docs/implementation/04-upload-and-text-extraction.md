# 04 — Upload and Text Extraction

**Requirements:** US-002, FR-02, FR-03; PRD §4 Flow 3 step 1, §5 upload constraints, Agent Capabilities row "PDF Text Extractor"; engineering-doc §4.3 (upload block), §9.1, §10 v0.2.
**Acceptance:** accepts PDFs ≤ 10 MB and ≤ 20 pages; rejects oversize, over-page, > 15,000-token, non-PDF, corrupt and scanned files with the exact messages; text is extracted **once**, carries `[PAGE N]` markers, and is stored in `contracts.contract_text`; a Storage failure does not fail the request.

---

## 1. Screen `/contracts/new`

Client Component. Two ordered steps in a single view.

### Step 1 — `ContractTypeSelect`
shadcn `Select`, options `NDA` and `MSA`, **required, no default** (placeholder "Choose a contract type"). Helper text: "ContractIQ supports NDAs and MSAs in English under US or UK law." The dropzone is visually and functionally **locked** (aria-disabled, non-droppable) until a type is chosen; the lock message reads "Choose a contract type first."

### Step 2 — `PdfDropzone`
Drag-and-drop plus a file picker, both wired to one `<input type="file" accept="application/pdf">` so the whole control is keyboard-operable (Enter/Space opens the picker; the drop target has `role="button"` and a visible focus ring).

**Client pre-checks, in order, before a single byte leaves the browser:**

| Check | Rule | Inline message |
|---|---|---|
| MIME / extension | `file.type === 'application/pdf'` | "That file isn't a PDF. Please upload a PDF contract." |
| Size | `file.size ≤ 10 MB` | "This file is {size} MB — the limit is 10 MB." |
| Pages | `pdfjs.getDocument({data}).numPages ≤ 20` | "This contract is {pages} pages — the limit is 20 pages for now." |

These are advisory; the server re-validates everything.

**Device advisory:** when `navigator.deviceMemory < 4` or the viewport is < 768 px **and** the file is > 7 MB, show a non-blocking banner: "For files near 10 MB we recommend desktop Chrome or Firefox." (PRD external dependency: browser file API limits.)

### `UploadProgress`
Determinate percentage from the `XMLHttpRequest`/`fetch` upload progress event, plus a Cancel button that aborts the request via `AbortSignal`. A cancelled upload writes nothing.

---

## 2. `POST /api/contracts/upload` — the authoritative gate

`runtime = 'nodejs'`. `Content-Type: multipart/form-data`. Fields: `file` (File), `contract_type` (`'NDA' | 'MSA'`).

Executed in this exact order — **each step short-circuits with its own error code, and nothing is written to the DB until step 8**:

1. **Session** — `supabase.auth.getUser()`; absent → `401 UNAUTHENTICATED`.
2. **Rate limit** — `upload` bucket, 20/hour/user → `429 RATE_LIMITED` with `Retry-After` (spec 13).
3. **Quota check** — `assertQuota(userId)` reads `profiles.plan`, `trial_ends_at`, `analyses_used` and `quota_period_start` → `402 QUOTA_EXCEEDED` (spec 13 §5). This is a read-only pre-check; the unit is consumed at step 7b.
4. **Schema** — `uploadSchema.parse({ contract_type })` → `400` with a field map.
5. **File presence and size** — missing file → `400 NOT_A_PDF`; `size > MAX_UPLOAD_MB * 1024 * 1024` → `413 FILE_TOO_LARGE` (message interpolates the real size to one decimal).
6. **Magic bytes** — the first five bytes must equal `%PDF-`; otherwise `400 NOT_A_PDF`. The declared MIME type is not trusted.
7. **Parse and validate the document** — `extractPdfText(buffer)` (§3):
   - parse throws → `422 CORRUPT_PDF`, **nothing stored** (PRD §11: "Corrupted PDF → graceful error message, no partial output stored").
   - `numpages > MAX_PAGES` → `422 TOO_MANY_PAGES`.
   - word count of the extracted text `< MIN_TEXT_WORDS` (100) → `422 SCANNED_PDF` ("Scanned PDFs are not supported yet.").
   - `estimateTokens(text) > MAX_TOKENS` → `422 TOO_MANY_TOKENS`.
   Pages and tokens are **independent hard gates checked in that order**, each with its own distinct message (A-09).
7b. **Consume the quota unit** — `consume_analysis_quota(user_id, period_start)`; a returned count above the plan limit is refunded immediately and the request fails `402 QUOTA_EXCEEDED`. Deleting a contract later never restores this unit (spec 13 §5).
8. **Insert** — one `contracts` row: `user_id`, `file_name` (original, unmodified), `contract_type`, `file_size_bytes`, `page_count`, `token_estimate`, `contract_text`, `file_path = NULL`, `status = 'uploaded'`, `last_accessed_at = now()`, `prompt_version = PROMPT_VERSION`.
9. **Storage (non-blocking, best effort)** — upload the bytes to `contracts/{user_id}/{contract_id}/{sanitised_filename}.pdf` with `contentType: 'application/pdf'`, `upsert: false`. On success `UPDATE contracts SET file_path = …` and `storage_available = true`. **On any failure**: log a warning, leave `file_path` NULL, set `storage_available = false`, and continue — the request still succeeds. The AI pipeline never depends on Storage.
9b. **On any failure after step 7b** — `refund_analysis_quota(user_id)` in the catch, so a user is never charged for a contract that was not created.
10. **Telemetry** — `processing_runs` rows for `stage='upload'` and `stage='text_extract'`; `activity_events` `upload_start` / `upload_complete`.

**Success `201`:**
```json
{ "contract_id": "uuid", "page_count": 12, "token_estimate": 9840,
  "storage_available": true, "status": "uploaded" }
```
Client then routes to `/contracts/{id}/prepare`.

**Error codes:** `400 NOT_A_PDF`, `413 FILE_TOO_LARGE`, `422 TOO_MANY_PAGES`, `422 TOO_MANY_TOKENS`, `422 SCANNED_PDF`, `422 CORRUPT_PDF`, `402 QUOTA_EXCEEDED`, `429 RATE_LIMITED`, `401 UNAUTHENTICATED`, `500 INTERNAL`.

---

## 3. `src/lib/pdf/extract-text.ts` — extraction once, at upload

```ts
export interface ExtractedPdf {
  text: string;        // "[PAGE 1]\n…\n\n[PAGE 2]\n…"
  pageCount: number;
  wordCount: number;
}
export async function extractPdfText(buffer: Buffer): Promise<ExtractedPdf>;
```

Implementation rules:
- Use `pdf-parse` with a custom `pagerender` callback that returns each page's text; accumulate pages into an array so page boundaries are exact rather than guessed from form-feeds.
- Join as `pages.map((t, i) => \`[PAGE ${i + 1}]\n${t.trim()}\`).join('\n\n')`. Markers are **1-indexed**, on their own line, uppercase, exactly `[PAGE N]` — the extraction prompt, the text viewer and page attribution all depend on this literal form.
- Normalise within a page: collapse 3+ newlines to 2, strip form-feed and zero-width characters, keep the rest verbatim so `source_sentence` verification can succeed.
- `pageCount` comes from `pdf-parse`'s `numpages`. `wordCount` is computed on the joined text **excluding** the `[PAGE N]` markers.
- A page with no text layer contributes an empty body but still emits its marker, so page numbering never drifts.

`src/lib/pdf/page-utils.ts`:
```ts
export function splitPages(text: string): { page: number; body: string }[];  // parses [PAGE N]
export function pageOfOffset(text: string, offset: number): number;          // nearest preceding marker
export function estimateTokens(text: string): number;                        // js-tiktoken, o200k_base
```

---

## 4. Non-contract and wrong-type uploads

Nothing at upload time detects contract type — detection happens during extraction (`detected_type`, spec 06). A user uploading an invoice is **not** blocked: extraction proceeds, confidence scores come back low, and the ⚠️ warnings plus the type-mismatch banner are the signals (PRD §11 "Consequences of bad input"; A-14).

---

## 5. Hooks and state

`src/hooks/use-upload.ts` — a TanStack Query mutation wrapping the multipart POST, exposing `{ upload, progress, isPending, error, reset }`. The upload wizard's state (selected type, file, client errors) lives in a `useReducer` Context (`UploadWizardContext`), not global state.

---

## 6. UX states

| State | Treatment |
|---|---|
| Idle | Dropzone with "Drag a PDF here, or browse" plus the limits line "PDF · up to 10 MB · up to 20 pages". |
| Uploading | Determinate progress bar, filename, Cancel. Live region announces "Uploading, {n} percent". |
| Server rejection | Inline error above the dropzone using the exact `userMessage`; the file is cleared; the contract type selection is preserved so the user can retry immediately. |
| Quota exceeded | Error plus a link to `/settings` explaining the plan's limit and reset date. |
| Success | Immediate client-side route to `/contracts/{id}/prepare`; no intermediate screen. |
| Storage unavailable | No error. `/prepare` shows an inline note: "The PDF preview isn't available for this contract — we'll show the contract text instead." |

---

## 7. Tests

- `tests/unit/extract-text.test.ts` — `[PAGE N]` marker placement and 1-indexing; empty page keeps its marker; word count excludes markers; 3-page fixture yields 3 sections.
- `tests/unit/page-utils.test.ts` — `splitPages` round-trips; `pageOfOffset` returns the nearest preceding marker; `estimateTokens` within ±5% of a reference count.
- `tests/integration/upload.test.ts` — happy path returns 201 with the right `page_count`/`token_estimate`; **every** rejection code exercised with its fixture (non-PDF bytes with a `.pdf` name, 11 MB file, 21-page file, 16,000-token file, 50-word scanned-style file, truncated/corrupt PDF); quota 402; rate-limit 429; and the Storage-failure path (Storage stubbed to throw) returning **201 with `storage_available: false` and `file_path` NULL**.
- `tests/integration/upload-no-partial.test.ts` — after `CORRUPT_PDF`, zero `contracts` rows exist for the user and `profiles.analyses_used` is unchanged (the failure precedes step 7b); a forced DB-insert failure after step 7b refunds the unit.
- `tests/e2e/contract-review.spec.ts` — covers the upload leg of the full journey.
