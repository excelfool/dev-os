# 05 — Term Library, Pre-Processing Preview and Custom Terms

**Requirements:** PRD §4 Flow 3 steps 2–3, FR-05, US-005, §5 (max 5 custom terms); engineering-doc §1 MOAT, §4.3, §9.2, §9.3, §10 v0.3, A-11.
**Acceptance:** the preview shows exactly the standard term list for the selected type before processing; up to 5 custom terms can be added, each with a "Custom" badge; the cap is enforced in the API **and** by a DB trigger; custom terms appear in results with the same structure as standard terms.

---

## 1. `src/lib/ai/term-library.ts`

The versioned, server-side term library is a MOAT pillar: it is what makes extraction contract-type-specific. It is static, typed code — no DB table, no runtime fetch.

```ts
export interface StandardTerm {
  term_name: string;      // exact string sent to the model and stored in key_terms.term_name
  display_rank: number;   // ≤ 12 => expanded by default on the results page
  tooltip: string;        // plain-English explanation, WCAG-required (PRD §5 usability)
  guidance: string;       // one line appended to the prompt's target list to disambiguate
}
export const TERM_LIBRARY_VERSION = 'v1.0';
export const NDA_TERMS: StandardTerm[];   // 10 terms, exactly as PRD §4 Flow 3 step 2 names them
export const MSA_TERMS: StandardTerm[];   // 12 terms, exactly as PRD §4 Flow 3 step 2 names them
export function termsFor(type: ContractType): StandardTerm[];
export function displayRankFor(type: ContractType, termName: string): number; // 99 if unknown/custom
```

### NDA — 10 standard terms (PRD-named, order = `display_rank`)

| rank | `term_name` | tooltip (plain English) | prompt guidance |
|---|---|---|---|
| 1 | Parties | Who is bound by this agreement. | Full legal names of every party, including entity type. |
| 2 | Effective Date | The date the agreement starts. | The stated commencement or signature date. |
| 3 | Confidentiality Obligations | What you must keep secret and how. | The core duty of non-disclosure and the standard of care. |
| 4 | Permitted Disclosures | When you are allowed to share the information. | Carve-outs such as legal compulsion, advisors, prior knowledge. |
| 5 | Term & Duration | How long the agreement and the secrecy duty last. | Both the agreement term and any survival period. |
| 6 | Governing Law | Which country's or state's law applies. | The named governing law. |
| 7 | Jurisdiction | Which courts decide a dispute. | The named forum or exclusive jurisdiction. |
| 8 | IP Ownership | Who owns the ideas and materials shared. | Ownership and any licence granted. |
| 9 | Non-Solicitation | Whether you may hire or approach the other side's people or clients. | Scope and duration of any non-solicit. |
| 10 | Breach & Remedy | What happens if the agreement is broken. | Remedies, injunctive relief, damages, cure periods. |

### MSA — 12 standard terms (PRD-named, order = `display_rank`)

| rank | `term_name` | tooltip | prompt guidance |
|---|---|---|---|
| 1 | Parties | Who is bound by this agreement. | Full legal names of every party. |
| 2 | Service Scope | What work is being delivered. | The described services or statement-of-work reference. |
| 3 | Payment Terms | How much you are paid or owe, and when. | Rates, fees and payment window (e.g. net 30). |
| 4 | Invoice Schedule | How often invoices are issued. | Invoicing cadence and submission requirements. |
| 5 | Late Payment Penalty | What happens if payment is late. | Interest rate or fixed penalty for late payment. |
| 6 | Liability Cap | The most either side can be made to pay. | The stated cap, its basis and any exclusions. |
| 7 | Indemnification | Who covers the other's losses, and for what. | Indemnity triggers and scope. |
| 8 | IP Ownership | Who owns what is created under the contract. | Ownership of deliverables, background and foreground IP. |
| 9 | Termination Clause | How and when either side can end the contract. | Termination for convenience and for cause. |
| 10 | Governing Law | Which country's or state's law applies. | The named governing law. |
| 11 | Dispute Resolution | How disagreements are settled. | Negotiation, mediation, arbitration or litigation path. |
| 12 | Notice Period | How much warning is required before ending or changing things. | The stated notice period and delivery method. |

**Growth path (A-11):** the PRD's "20–30 terms that actually matter" is reached by appending entries with `display_rank > 12`. Nothing in the schema, the API or the UI changes — the extra terms simply land under "Show all terms".

`tooltip` strings are the source for the plain-English jargon tooltips required by PRD §5 usability and WCAG 2.1 AA (spec 16).

---

## 2. Screen `/contracts/[id]/prepare`

Server shell (fetches the contract, its `contract_type`, `status` and `file_path`) + client island.

**Guards:**
- Contract not owned / missing → `notFound()`.
- `status === 'completed'` → `redirect('/contracts/{id}')`. Custom terms are a pre-processing-only concept.
- `status === 'processing'` → render the 3-step progress indicator in its in-flight state instead of the preview.

### `TermPreviewList`
Lists `termsFor(contract_type)` in `display_rank` order, each row: term name + an info icon exposing the plain-English `tooltip` (reachable on focus, not hover-only). Heading: "ContractIQ will look for these {n} terms in your {NDA|MSA}." Custom terms already added appear at the end of the list with a **"Custom"** badge and a remove control.

If `file_path IS NULL` (upload response reported `storage_available: false`), an inline note reads: "The PDF preview isn't available for this contract — we'll show the contract text instead."

### `CustomTermInput`
- A **"+ Add Key Term"** button opens a text input with placeholder "e.g. Non-compete radius".
- Client validation: trimmed length 3–60; case-insensitive duplicate check against **both** the standard list for this type and existing custom terms → "You've already added that term." / "That's already one of the standard terms we look for."
- Adding posts immediately (`POST /api/contracts/{id}/custom-terms`); the list updates optimistically and reconciles on the server response, rolling back with a toast on failure.
- At 5 terms the button is disabled with helper text **"5 custom terms is the limit for now."**
- Removing calls `DELETE /api/contracts/{id}/custom-terms/{termId}`.

### `ProcessButton` + `ProcessingSteps`
"Process Contract" is always enabled once the contract exists (custom terms are optional). Pressing it calls `POST /api/contracts/{id}/process` and swaps the view for the 3-step indicator (spec 06).

---

## 3. `POST /api/contracts/{id}/custom-terms`

**Request:** `{ "term_names": ["Non-compete radius"] }` (1–5 entries).

Order of checks:
1. Session + ownership of the contract.
2. `status` must be `'uploaded'` or `'error'`; anything else → `409 ALREADY_PROCESSED`.
3. `customTermSchema.parse` — each name trimmed, 3–60 chars → `400 INVALID_TERM_NAME`.
4. Case-insensitive dedup against the standard list for the contract's type and against existing `custom_key_terms` rows → `409 DUPLICATE_TERM`.
5. `existing_count + new_count ≤ MAX_CUSTOM_TERMS (5)` → `422 CUSTOM_TERM_LIMIT` with the message "5 custom terms is the limit for now."
6. Insert rows with `is_manual = true`, `user_id = auth.uid()`.

The DB trigger `enforce_custom_term_limit` is the second, independent enforcement point — a raised `CUSTOM_TERM_LIMIT` from Postgres is caught and mapped to the same `422`.

**Success `201`:** `{ "custom_terms": [{ "id", "term_name", "is_manual": true }] }`

## 4. `DELETE /api/contracts/{id}/custom-terms/{termId}`

Ownership verified; `status` must still be `'uploaded'` or `'error'` → else `409 ALREADY_PROCESSED`. **Success `204`.** `404 NOT_FOUND` when the term id does not belong to this contract.

---

## 5. How custom terms reach the results

`extraction-service` reads `custom_key_terms` for the contract and appends the names to the prompt's target list **zero-shot, in the same JSON schema** as standard terms (spec 06 §2). Returned rows are persisted to `key_terms` with `is_custom = true` and `display_rank = 99`, so they carry value, page number, confidence score and source sentence exactly like standard terms (FR-05, US-005) and sit under "Show all terms" unless the user expands.

If a custom term is not found in the document, it is persisted with `value = NULL` and rendered "Not found in document" at 0% confidence — never silently dropped.

---

## 6. Tests

- `tests/unit/term-library.test.ts` — NDA has exactly the 10 PRD-named terms and MSA exactly the 12, in `display_rank` order; every term has a non-empty tooltip; `displayRankFor` returns 99 for an unknown name.
- `tests/unit/custom-term-validation.test.ts` — 2-char and 61-char rejected, 3-char and 60-char accepted; case-insensitive duplicate detection against standard and custom lists.
- `tests/integration/custom-terms.test.ts` — the 6th term is rejected by the API with `CUSTOM_TERM_LIMIT`; a **direct DB insert** of a 6th term is rejected by the trigger; adding after `status='completed'` returns `409 ALREADY_PROCESSED`; delete returns 204 and removes the row.
- `tests/e2e/contract-review.spec.ts` — the preview lists the right term set for the chosen type; a custom term is added, shows the "Custom" badge, and appears in the results with value/page/confidence.
- Eval: custom-term F1 ≥ 80% over 10 predefined terms × 15 contracts (spec 17).
