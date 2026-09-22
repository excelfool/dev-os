# 07 — Results Page: Viewers, Key-Terms Panel and Inline Editing

**Requirements:** US-003, US-004, US-006, US-009, FR-04, FR-06, FR-07, FR-11; PRD §4 Flow 3 steps 5–9, §9 guardrails, §11 HHH; engineering-doc §4.3 (results block), §5.3, §5.4, §9.6, §9.7, §9.8, §10 v0.3/v0.4.

---

## 1. Route `/contracts/[id]`

Server Component shell + client panels.

**Server fetch** (`GET` equivalent of `/api/contracts/{id}`, executed directly with the server Supabase client):
- `contracts` row (owner-scoped) — 404 → `notFound()`.
- `key_terms` ordered by `display_rank, term_name`.
- `custom_key_terms`.
- **Touches `contracts.last_accessed_at = now()`** — this is the anchor for the 90-day retention clock (A-10).
- Writes `activity_events` `results_viewed` on mount (spec 14 §3 vocabulary).
- `status === 'uploaded'` → redirect to `/contracts/{id}/prepare`. `status === 'error'` → render the error state with a Retry CTA instead of panels. `status === 'processing'` → render `ProcessingSteps` and poll `GET /api/contracts/{id}` every 2 s until it settles. The poll touches `last_accessed_at` (and therefore `updated_at`) but **never** `processing_started_at`, so it cannot mask a stuck run from the 5-minute reclaim (spec 06 §3a). If the contract flips to `error` while polling, the page swaps to the error state with its Retry CTA.

**Layout (≥ 1024 px):** two panels, left `DocumentPanel` (≈ 58%), right `KeyTermsPanel` (≈ 42%), with `ChatPanel` opening inside the same view (spec 08) — the document and terms panels stay mounted.

Always rendered above the panels, in this order:
1. **`DisclaimerBanner`** — "This is an AI-assisted review tool, not legal advice. Always verify critical terms with a qualified lawyer." Present on **every** results page, not dismissible.
2. **`TypeMismatchNotice`** — only when `type_mismatch_warning` is true: "This doesn't look like the {NDA|MSA} you selected — we still extracted everything we could, but some type-specific terms may be missing." Dismissible for the session.
3. **`CalibrationNotice`** — only when `CALIBRATION_WARNING_ACTIVE` is true: "Our confidence scores are currently being recalibrated — treat them as approximate." (PRD §11 Honest; ≥ 15% miscalibration.)
4. **"About these results"** disclosure carrying the stated model limitations verbatim (spec 16 §6).

---

## 2. `DocumentPanel` — viewer selection

```
file_path != null  AND PDF.js renders      -> PdfViewer
file_path != null  AND PDF.js throws       -> TextViewer + DownloadPdfLink
file_path == null  (storage failure/purge) -> TextViewer (+ purge note when pdf_purged_at)
```

Both viewers implement the **same contract** so the rest of the app never branches on which one is mounted:

```ts
interface DocumentViewerProps {
  pageCount: number;
  targetPage: number | null;      // set by a page chip or a citation chip
  highlight: { page: number; text: string } | null;
  onPageVisible?(page: number): void;
}
```

### `PdfViewer`
- `pdfjs-dist`; worker served from `public/pdf.worker.min.mjs` (never a CDN — no third-party egress of contract bytes).
- Source: the 1-hour signed URL from `POST /api/contracts/{id}/signed-url`. The URL is fetched on mount and refreshed if the panel is open past 55 minutes.
- **Lazy, virtualised page rendering** — only pages in and adjacent to the viewport are rendered to canvas; this is the stated mitigation for large-file memory pressure.
- Controls: scroll, zoom in / zoom out / fit-width (keyboard: `+`, `-`, `0`), visible page-number label per page, and a "Page X of N" indicator.
- **Highlighted spans:** after render, each page's text layer is scanned for the normalised `source_sentence` of every term on that page; matches get a `<mark>` with the term name as `aria-label`. Clicking a mark selects the corresponding term row.
- `404 NO_FILE` from the signed-url route → silently fall back to `TextViewer` (this is the expected state after a purge or a Storage failure; it is not an error to the user).
- Any render throw → fall back to `TextViewer` **plus** `DownloadPdfLink` when `file_path` exists, and record the failure in `activity_events` (`pdf_render_failed`, metadata: page index and error name only).

### `TextViewer`
- Built from `splitPages(contract_text)`; renders each page as a labelled `<section aria-label="Page N">` with a sticky "Page N" header.
- Supports the identical `targetPage` navigation and the same highlight flash.
- It is a **first-class alternative**, not a degraded mode: it is also the recommended surface for screen-reader users (spec 16).
- When `pdf_purged_at` is set, a note reads: "The original PDF was removed after 90 days of inactivity. Your extracted text, key terms and chat history are unchanged."

### `DownloadPdfLink`
Shown only when `file_path` exists and the PDF viewer failed. Uses the same signed URL with `download` set.

---

## 3. Page navigation (`useTargetPage`)

`src/hooks/use-target-page.ts` exposes `{ targetPage, highlight, goToPage(page, text?) }` from a React Context mounted at the results page. Consumers: `PageChip` (terms panel), `PageCitationChip` (chat), and `KeyTermRow` auto-highlight.

On `goToPage`:
1. The active viewer smooth-scrolls the page into view (`behavior: 'smooth'`, honouring `prefers-reduced-motion: reduce` by jumping instead).
2. The referenced span flashes a highlight for 1.5 s (yellow-100 background, animated only when motion is allowed).
3. A live region announces "Showing page {n}".

**Low-confidence auto-highlight (PRD §9 UI guardrails):** expanding a term whose `confidence_score < 50` calls `goToPage(page, source_sentence)` automatically, so the nearest matching span is highlighted in one click. When `page_number` is null, the panel shows "No page reference — verify manually" and no navigation occurs.

---

## 4. `KeyTermsPanel`

Header: "Key terms" + the count, and a "Show all terms" disclosure.

**Ordering and disclosure (A-11):** rows with `display_rank ≤ 12` render expanded by default; the remainder (including custom terms, rank 99) collapse under **"Show all terms ({n})"**. No term is ever hidden from the user — collapsed is not hidden, and the disclosure is keyboard-operable and announced.

### `KeyTermRow`
Columns: **Term Name | Extracted Value | `PageChip` | `ConfidenceBadge`** (FR-04).

- **Term name** carries the plain-English tooltip from the term library (focusable, not hover-only). Custom terms carry a **"Custom"** badge.
- **Value** — the extracted string, or **"Not found in document"** in muted italics when `value` is null.
- **`PageChip`** — "Page {n}", a button that calls `goToPage(n, source_sentence)` (FR-07, US-003). Rendered as inert text "—" when `page_number` is null.
- **`ConfidenceBadge`** — `{n}%` with the band colour, band icon and text label from spec 06 §6. For `< 50`: a ⚠️ icon plus a **non-dismissible** tooltip reading exactly *"Low confidence — we recommend verifying this in the document directly."* The term is **never hidden** (FR-11).
- **`WhySection`** — an expandable "Why?" disclosure showing the verbatim `source_sentence` in a quote block with "Found on page {n}". When `is_source_verified` is false it adds: "We couldn't match this sentence to the document text — verify it directly." When `source_sentence` is null it reads: "No supporting sentence was found for this term."
- **"Edited" badge** — shown when `is_edited`, with a tooltip "You edited this value. The original AI value is kept for accuracy tracking."

---

## 5. Inline editing (`InlineTermEditor`, US-009)

Interaction: click the value (or press Enter on the focused value button) → an input replaces it, pre-filled and text-selected. **Enter saves, Esc cancels**, blur saves. Validation: 1–2,000 characters; empty → "Enter a value between 1 and 2,000 characters."

Save path: `PATCH /api/key-terms/{id}` with `{ "value": "24 months" }`.
- Optimistic update through TanStack Query with rollback plus an error toast on failure.
- Server: ownership re-checked, `UPDATE key_terms SET value=$1, is_edited=true, edited_at=now()`. **`original_ai_value` is never modified** — it was captured at insert.
- Response `200 { id, value, is_edited: true, original_ai_value, edited_at }`, **within the 2-second budget**.
- Client records `activity_events` `term_edited` with the measured `durationMs` (the evidence for the ≤ 2 s target).
- The edited row now surfaces in the `term_corrections` view that drives the ≤ 12% correction-rate alert.

**Privacy nuance (A-12):** every edit is stored — it is the user's own record and the input to the aggregate correction-rate metric, owner-only under RLS. Only rows whose owner has `profiles.feedback_opt_in = true` are exported, stripped of identifiers, for prompt improvement.

---

## 6. `POST /api/contracts/{id}/signed-url`

Ownership verified. `file_path IS NULL` → `404 NO_FILE` (the client falls back silently). Otherwise `createSignedUrl(file_path, SIGNED_URL_TTL_SECONDS)`.
**Success `200`:** `{ "url": "https://…", "expires_in": 3600 }`.

---

## 7. States

| State | Treatment |
|---|---|
| Loading | Skeletons for the terms rows and for each PDF page canvas. Never a bare spinner. |
| `status='processing'` | `ProcessingSteps` with 2-second polling. |
| `status='error'` | The stored `error_message` plus "Try again in a few minutes" calling `/process` again — no re-upload. |
| Terms panel empty | Cannot occur after a successful run: unfound terms are stored with `value = null` and rendered "Not found in document" at 0%. |
| Storage unavailable / purged | `TextViewer` with the explanatory note; everything else works. |
| PDF render failure | `TextViewer` + `DownloadPdfLink`. |
| Tablet (768–1023 px) | Tabs: Document / Terms / Chat. |
| Mobile (< 768 px) | Single-column stack; chat as a bottom sheet; advisory that large PDFs are best reviewed on desktop Chrome or Firefox. |

---

## 8. Tests

- `tests/unit/key-term-row.test.tsx` — `< 50` renders the ⚠️ icon **and** the exact tooltip text and is still visible; null value renders "Not found in document"; null page renders an inert "—"; the "Custom" and "Edited" badges appear under the right conditions.
- `tests/unit/viewer-target-page.test.tsx` — both `PdfViewer` and `TextViewer` respond identically to a `targetPage` change.
- `tests/integration/key-term-edit.test.ts` — `PATCH` sets `is_edited`/`edited_at`, leaves `original_ai_value` untouched, rejects 0-char and 2,001-char values with `INVALID_VALUE`, and refuses another user's term id with `404`.
- `tests/integration/signed-url.test.ts` — 1-hour expiry returned; `404 NO_FILE` when `file_path` is null.
- `tests/e2e/navigation.spec.ts` — clicking a page chip scrolls the viewer to that page and flashes the highlight, in both viewers.
- `tests/e2e/viewer-fallback.spec.ts` — with Storage disabled, the results page renders the text viewer and all terms.
- `tests/e2e/edit.spec.ts` — inline edit saves in **under 2 s** and the "Edited" badge appears.
- `tests/e2e/disclaimer.spec.ts` — `DisclaimerBanner` is present on every results page.
- `tests/unit/low-confidence-invariant.test.ts` — for a generated set covering 0–100, every score `< 50` yields ⚠️ + tooltip + a visible row. The **same assertion module** is reused by the nightly production job over every beta contract (spec 14 §4), which is what evidences part (a) of the Measurement Beta gate; the unit test alone does not.

---

## v1.1 amendments (PRD v1.1, 2026-09-21 — R-9, R-12a, R-16, R-18, R-24, Flow 3 steps 5–10)

### A. Right-panel order (Flow 3 step 5)

Top to bottom: `ReviewNeededNotice` (spec 06 v1.1 §C, only when `required_missing` is non-empty) → **`SummaryCard`** (§B) → **`RiskPanel`** (spec 20 §4.1, via `<Capability key="risk.flag">`) → `KeyTermsPanel` → `KeyDatesCard` (spec 21 §7.4) → `CompleteReviewButton` + `FeedbackWidget` (spec 10). The header gains `ReviewModeToggle` (§E) and, once `risk.flag` is built, the High-flag count badge.

### B. `SummaryCard` (US-015)

- `summary_status='completed'`: heading "Summary", the `summary_md` rendered as Markdown (headings stripped to bold, lists kept), with every `[Page X]` turned into a `PageCitationChip` that calls `goToPage(X)` — the same chip as chat. A "≤ 200 words · generated by AI" caption. When `summary_uncited` is true, the spec 08 §1 unverified-citation notice is shown under the card.
- `'pending'`: skeleton with "Writing the summary…" while the page issues **one** `POST /api/contracts/{id}/summary`; a `409 SUMMARY_NOT_PENDING` means another path holds the claim — treat as `'processing'`.
- `'processing'` (the inline call or another tab holds the claim): the same skeleton, polling `GET /api/contracts/{id}` every 2 s for up to 30 s until `completed`/`error`; the page never issues a second POST while the claim is fresh. **After 30 s** the card reads "Still writing the summary…" and keeps polling every 10 s. **When `summary_claim_stale` is true** — on any poll or on a fresh page load — the card shows the **Generate summary** button (and, if the page was loaded with the claim already stale, issues the reclaim POST automatically, once); the route's 2-minute rule makes that POST succeed, so a killed function never leaves the card stuck.
- `'error'`: "We couldn't write a summary for this contract." + **Generate summary** button (same route; allowed when status is `error`).
- `'none'` (legacy contracts processed before v1.1): the same button, labelled "Generate summary".
- Hidden entirely while `extract.summary` is `planned` in the registry (P-6); the card exists in code from day one.

### C. `WhySection` shows source sentence **and** reasoning (FR-04, R-16)

Two labelled blocks: **"Source"** — the verbatim `source_sentence` quote with "Found on page {n}" (existing); **"Reasoning"** — the `reasoning` sentence in normal text, or "No reasoning was returned for this term." when null. The existing unverified-source and no-sentence notes are unchanged.

### D. Inline editing of value, page and reasoning (US-009)

`InlineTermEditor` handles three fields; each opens from its own control and saves independently within 2 s:

| Field | Control | Validation | PATCH body |
|---|---|---|---|
| value | click the value (existing) | 1–2,000 chars → `INVALID_VALUE` | `{ "value": "…" }` |
| page | click the `PageChip` edit icon (pencil, `aria-label="Edit page number"`) → numeric input | integer `1..page_count` → `400 INVALID_PAGE` ("Enter a page between 1 and {page_count}.") | `{ "page_number": 4 }` |
| reasoning | "Edit" link in the Reasoning block → textarea | 1–500 chars → `400 INVALID_REASONING` ("Enter reasoning between 1 and 500 characters.") | `{ "reasoning": "…" }` |

`PATCH /api/key-terms/{id}` accepts any non-empty subset of `{ value, page_number, reasoning }` (`keyTermUpdateSchema` v1.1). Server: `value` ⇒ `is_edited=true`; `page_number` ⇒ `page_edited=true`; `reasoning` ⇒ `reasoning_edited=true`; always `edited_at=now()`. **`original_ai_value`, `original_ai_page`, `original_ai_reasoning` are never modified.** Response `200 { id, value, page_number, reasoning, is_edited, page_edited, reasoning_edited, original_ai_value, original_ai_page, original_ai_reasoning, edited_at }`. Editing `page_number` re-runs `goToPage` on the new page and re-scans the highlight; editing a reminder-source term (spec 21 §7.2) re-derives key dates. `activity_events` `term_edited` metadata gains `field: 'value'|'page'|'reasoning'`.

Badges: "Edited" on the value (existing); a small "Page edited" / "Reasoning edited" tag next to the respective field, each with the tooltip "You changed this. The original AI {value|page|reasoning} is kept for accuracy tracking." The correction-rate metric keeps counting `is_edited` (value) only; page and reasoning edits are reported as separate rates in `v_kpi_correction_rate_weekly` (spec 23 §4.6).

### E. Review mode entry (Flow 3 step 10)

`ReviewModeToggle` in the results header (`<Capability key="eval.hhh_human">` — absent while `planned`): a switch labelled **"Review"** that turns on the per-term `HhhQuestionnaire` disclosures and the sticky progress footer defined in spec 22 §4, and reads `?mode=review`. Review mode changes nothing else on the page.

### F. High-risk label

`HighRiskLabel` ("High risk — recommend human/legal review") belongs to `RiskFlagRow` (spec 20 §4.1); it is never rendered on key-term rows and never rendered while `risk.flag` is not `built`.

### G. Tests added

- `key-term-row.test.tsx` — the Reasoning block renders the sentence, or the null copy; "Page edited"/"Reasoning edited" tags appear only for their field.
- `tests/integration/key-term-edit.test.ts` — `{ page_number: 0 }` and `{ page_number: page_count + 1 }` → `INVALID_PAGE`; `{ reasoning: '' }` → `INVALID_REASONING`; a page edit leaves `original_ai_page` untouched; an empty body → `400 VALIDATION`.
- `tests/unit/summary-card.test.tsx` — the four statuses render as specified; `[Page 3]` becomes a chip that calls `goToPage(3)`; `processing` shows the skeleton and no POST; `processing` + `summary_claim_stale=true` shows Generate summary and issues exactly one reclaim POST on load.
- `tests/e2e/edit.spec.ts` — editing page and reasoning each save in **under 2 s** and show their tag.
- `tests/e2e/placeholders.spec.ts` — right-panel order is Summary → Risk (empty state) → Key terms → Key dates.
