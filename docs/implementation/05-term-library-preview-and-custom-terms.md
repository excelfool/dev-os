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

---

## v1.1 amendments (PRD v1.1, 2026-09-21 — R-21, US-016 field mapping, §8 term table)

### A. `StandardTerm` gains the instructor fields; the MSA library becomes the 36 instructor terms

```ts
export interface StandardTerm {
  term_id: number;         // instructor id (MSA) or 1–10 (NDA); stable across renames
  term_name: string;       // exact string sent to the model and stored in key_terms.term_name — instructor spelling kept verbatim
  question: string;        // the question the extraction prompt asks (R-21c)
  answer_format: string;   // the constraint appended to the question
  display_rank: number;    // ≤ 12 => expanded by default
  tooltip: string;         // plain-English explanation (WCAG)
  is_required: boolean;    // "required field not found => flag for review" (spec 06 v1.1 §C)
}
export const TERM_LIBRARY_VERSION = { NDA: 'v1.0', MSA: 'instructor-2026-09' } as const;
export const NDA_TERMS: StandardTerm[];   // 10, unchanged names (PRD §4 Flow 3 step 2)
export const MSA_TERMS: StandardTerm[];   // 36, loaded verbatim from docs/reference/key-terms-msa-instructor.json
```

`MSA_TERMS` is generated at build time from `docs/reference/key-terms-msa-instructor.json` (copied to `src/lib/ai/term-library/msa-instructor.json` by `npm run eval:sync-refs`; a unit test asserts the two files are byte-identical), so `term_name`, `question`, `answer_format` and `display_rank` can never drift from the instructor file. The `guidance` field is retired for MSA — the `question` + `answer_format` replace it in the prompt (spec 06 v1.1 §A). The v1.0 12-term MSA list in §1 is **retired as the library**; its coverage is carried by ranks 1–2, 6, 7, 9, 14, 20–22, 26–27 and 35–36 (PRD §8). `Service Scope`, `Invoice Schedule` and `Dispute Resolution` are not in the instructor set and can be added as custom terms.

### B. The 36 MSA terms — tooltips and the required set (names/questions/formats are the instructor file's, reproduced in PRD §8 and not repeated here)

| rank | `term_name` | tooltip | required |
|---|---|---|---|
| 1 | Service Provider Name | The company providing the services. | **yes** |
| 2 | Customer Name | The company buying the services. | **yes** |
| 3 | Contract start date | When the agreement begins. | **yes** |
| 4 | Contract end date | When the agreement ends unless renewed. | no |
| 5 | Term Period In Months | How long the agreement runs, in months. | no |
| 6 | Deal Value | The total amount the customer pays. | no |
| 7 | Governing Law | Which country's or state's law applies. | no |
| 8 | Auto Renewal | Whether the agreement renews by itself. | no |
| 9 | Termination Notice In Days | How much warning is needed to end the agreement. | no |
| 10 | Data Breach Notice In Hours | How quickly a data breach must be reported. | no |
| 11 | Billing frequency (monthly, quarterly, annually, other) | How often you are invoiced. | no |
| 12 | Renewal Period (Months) | How long each renewal lasts. | no |
| 13 | Notice to not auto renew (Days) | How many days before renewal you must object. | no |
| 14 | Net payment terms (Net 30, 45, 60, 75, 90, other) | How many days you have to pay an invoice. | no |
| 15 | Termination for Breach (Yes, No, N/A) | Whether a serious breach lets a party end the agreement. | no |
| 16 | Termination for cause (Yes, No, N/A) | Whether a stated reason lets a party end the agreement. | no |
| 17 | Termination without cause (Yes, No, N/A) | Whether a party can end the agreement with no reason. | no |
| 18 | Termination for convenience (Yes, No, N/A) | Whether a party can simply choose to end the agreement. | no |
| 19 | Notice of termination for convenience (Days) | Warning needed to end the agreement for convenience. | no |
| 20 | Late Payment Charges (Yes, No, N/A) | Whether late invoices attract charges. | no |
| 21 | Late Payment Penalty | How late-payment charges are calculated. | no |
| 22 | Limitations of liability (Amount) | The most either side can be made to pay. | no |
| 23 | Assignment (consent, No consent, N/A) | Whether the provider needs your consent to hand the contract to someone else. | no |
| 24 | Name and logo use (Yes, No, N/A) | Whether the provider may use your name and logo. | no |
| 25 | Deletion of Data (Yes, No, N/A) | Whether your data must be deleted on request or at the end. | no |
| 26 | Customer Indemnity | What losses you must cover for the provider. | no |
| 27 | Service Provider indemnity | What losses the provider must cover for you. | no |
| 28 | Customer notice for indemnitiy claim | Whether you must give notice to claim indemnity. | no |
| 29 | Indemnify Attorney fees (Yes, No, N/A) | Whether legal fees are covered by the indemnity. | no |
| 30 | Price increase (Yes, No, N/A) | Whether the provider can raise prices. | no |
| 31 | Notice for price increase (days) | How much warning you get before a price rise. | no |
| 32 | Insurance Clause | What insurance the agreement requires. | no |
| 33 | Maintenance of Insurance | Whether insurance must be kept for the whole term. | no |
| 34 | Provide notice for insurance (Days) | Warning required for insurance changes. | no |
| 35 | Service Provider Intellectual Property Rights | What the provider owns. | no |
| 36 | Customer Intellectual property rights | What you own. | no |

NDA required terms: `Parties`, `Effective Date`. NDA `question`/`answer_format` (added so one prompt path serves both types; names unchanged): the question is `What is the {term_name}?` prefixed with the existing `guidance`, and `answer_format` is `verbatim clause text or short summary, or N/A` for every NDA term except `Effective Date` (`date (YYYY-MM-DD), or N/A`) and `Governing Law` (`name of jurisdiction only`).

### C. Preview and custom-term changes

- `TermPreviewList` heading for MSA: "ContractIQ will look for these 36 terms in your MSA." Ranks 1–12 render expanded; ranks 13–36 sit under **"Show all 36 terms"** (collapsed, not hidden — `aria-expanded`, keyboard-operable). NDA is unchanged (10 terms, all expanded).
- Each row shows the term name, the info tooltip, and the **question** in muted text ("We'll ask: *What is the Governing Law? Provide just the name of the governing law*") so the user sees what the human would ask (PRD Flow 3 step 2).
- Custom-term duplicate check (§2, §3 step 4) now runs against the 36 MSA names.
- CRM field mapping (US-016, Assumption 16) is **exactly the `display_rank ≤ 12` MSA terms**, read from this library by spec 21 §5 route 27 — no second list.
- `displayRankFor()` returns the instructor `display_rank`; custom terms remain 99.
- Custom terms (§5) carry the **same structure as standard terms including `reasoning`** (US-005 v1.1): the zero-shot target list gives them the default answer format and the prompt's `reasoning` rule applies to every returned object (spec 06 v1.1 §A).

### D. Tests (replace the counts in §6)

- `term-library.test.ts` — NDA has exactly the 10 names; MSA exactly the 36 names in `display_rank` order 1–36, byte-equal to the reference JSON's `term_name`/`question`/`answer_format`/`display_rank`; every term has a non-empty tooltip and question; the required set is `{1,2,3}` for MSA and `{Parties, Effective Date}` for NDA; `TERM_LIBRARY_VERSION.MSA === 'instructor-2026-09'`.
- `custom-term-validation.test.ts` — "Governing Law" is rejected as a duplicate for MSA; "Service Scope" is accepted.
- `contract-review.spec.ts` — the MSA preview shows 12 expanded rows and a "Show all 36 terms" disclosure that reveals 24 more.

### E. Superseded v1.0 lines (read the v1.1 value)

| v1.0 text | v1.1 value |
|---|---|
| §1 `MSA_TERMS` "12 terms" | 36 terms (§A above) |
| §2 "render the 3-step progress indicator" and `ProcessButton` "swaps the view for the 3-step indicator" | the **four-step** indicator of spec 06 v1.1 §B (Extracting text · Analysing with AI · Summarising · Compiling results) |
