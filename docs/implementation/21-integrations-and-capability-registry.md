# 21 — Capability Registry, Integration Adapters, Key-Date Reminders and the 501 Contract

**Requirements:** PRD v1.1 Appendix A P-1, P-2, P-4, P-6, P-7; Appendix B (every key); §4 Flow 2 step 3 (`/settings` "What ContractIQ can do today"); Flow 3 step 1 (import / DOCX / scanned shown as disabled options naming their phase); §3 components 1, 2, 9; §3 external dependencies "OCR vendor", "CRM vendor APIs"; §3 roadmap v1.1 DOCX / reminders, v1.2 OCR / DocuSign; US-016, US-017; FR-02 note (DOCX ⇒ `422 UNSUPPORTED_FORMAT`); agent table rows "Ingestion & OCR agent", "CRM pusher", "Reminder scheduler"; §6 Integrations layer, "planned routes return 501"; §7 `retrieval.n8n`; §11 Accountability (registry visible at `/settings`, limitations copy); §12 `billing` planned; Assumptions 15, 16.
**Delta rows closed:** Comp 1, Comp 2, Comp 9, Flow 2 step 3, Flow 3 step 1, US-016, US-017, FR-02, Ingestion & OCR agent, CRM pusher, Reminder scheduler, External deps OCR/CRM, P-1, P-2, P-4, P-6, P-7, `ingest.docx`, `ingest.ocr`, `import.*`, `redline.word`, `qa.cross_contract`, `retrieval.graph`, `retrieval.n8n`, `reminders.key_dates`, `crm.*`, `esign.docusign`, `billing`, Accountability limitations/registry.

---

## 1. `src/lib/capabilities.ts` — the one registry (P-1)

### 1.1 Type

```ts
export type CapabilityStatus = 'built' | 'stub' | 'planned';
export interface Capability {
  key: CapabilityKey;              // string-literal union of every key below
  status: CapabilityStatus;
  phase: string;                   // '—' when built; else the PRD phase label
  owner: 'product' | 'engineering';
  prd_ref: string;                 // PRD v1.1 section / story that defines it
  since: string;                   // ISO date the entry was added or last changed
  label: string;                   // user-facing name for the /settings table
  user_note: string;               // one plain-English sentence for /settings
}
export const CAPABILITIES: Readonly<Record<CapabilityKey, Capability>>;
export function getCapability(key: CapabilityKey): Capability;
export function isBuilt(key: CapabilityKey): boolean;
export function notImplemented(key: CapabilityKey): AppError;   // §1.3
```

The map is **static code**, not a table: it is the source of truth and is deployed with the build (changing a status is a code change + deploy, which is what makes it reviewable). It is imported by server and client (`user_note`/`label` are safe to ship), so the file must not import `server-only` modules.

### 1.2 Entries — exactly PRD Appendix B (2026-09-21); `since` = `2026-09-21` unless noted

| `key` | status | phase | prd_ref | label / user_note |
|---|---|---|---|---|
| `ingest.pdf_text` | built | — | §3 comp 2, FR-03 | "Text-layer PDF upload" / "Upload PDFs up to 10 MB and 20 pages." |
| `ingest.docx` | stub | v1.1 | §1 Why Agentic AI, FR-02 | "Word (.docx) upload" / "Coming in v1.1 — today a .docx is declined with a clear message." |
| `ingest.ocr` | stub | v1.2 | §3 comp 2, Assumption 15 | "Scanned / photographed contracts (OCR)" / "Coming in v1.2 — scanned PDFs are declined today." **Flips to `built` only when** a vendor adapter is configured **and** `eval/runners/ocr-accuracy.ts` reports PASS over `eval/datasets/ocr-sample/` — **~100 labelled scanned SMB contracts** (text fidelity ≥ 95 % against the labelled text; the < 80 %-confidence rejection rate reported) — `SKIPPED` until both exist (P-5; PRD Assumption 15) |
| `import.drive` | planned | v1.1 | Flow 3 step 1 | "Import from Google Drive" / "Planned for v1.1." |
| `import.dropbox` | planned | v1.1 | Flow 3 step 1 | "Import from Dropbox" / "Planned for v1.1." |
| `import.sharepoint` | planned | v1.1 | Flow 3 step 1 | "Import from SharePoint" / "Planned for v1.1." |
| `classify.contract_type` | built | — | §3 comp 3 | "Contract-type check" / "Warns when the document doesn't look like the type you chose." |
| `extract.key_terms` | built | — | §3 comp 4, §8 | "Key-term extraction (NDA 10 terms, MSA 36 terms)" / "Value, page, confidence, source sentence and reasoning per term." |
| `extract.summary` | planned | v0.3 | US-015 | "Plain-language summary" / "First build item — arrives with the next release." (`since` flips and status becomes `built` when spec 06 v1.1 §B ships) |
| `playbook.manage` | stub | Phase 1 | US-014 | "Playbooks" / "A default MSA playbook is seeded; editing arrives in Phase 1." |
| `risk.flag` | stub | Phase 1 | US-013 | "Risk & compliance flags" / "Arrives in Phase 1; the panel shows its status today." |
| `risk.escalate` | stub | Phase 1 | §9 rule 4 | "Hand-off to a human reviewer" / "Arrives in Phase 1." |
| `redline.word` | planned | Phase 2 | §3 roadmap v1.2 | "Redlined Word document" / "Planned." |
| `qa.single_contract` | built | — | US-007 | "Chat with your contract" / "Grounded answers with page citations." |
| `qa.cross_contract` | planned | Phase 3 | §3 roadmap v2 | "Questions across several contracts" / "Planned." |
| `retrieval.full_context` | built | — | §7 | "Full-document grounding" / "The whole contract is read on every question." |
| `retrieval.query_enhancer` | **built** (2026-09-23; was planned, v0.4) | — | §7, Flow 4 step 2 | "Question rewriting for better answers" / "Your question is rewritten into a precise search before the contract is read." (built with spec 08 v1.1 §B, Stage 6) |
| `retrieval.vector` | stub | v2 | §7 | "Vector retrieval for long contracts" / "Reserved for contracts beyond 20 pages." |
| `retrieval.graph` | planned | v2 | §7 | "Knowledge-graph retrieval" / "Planned." |
| `retrieval.n8n` | stub | — | §7 | "External RAG backend (n8n)" / "Available only when an operator configures it." |
| `compare.contracts` | stub | v1.2 | §3 roadmap v1.2 | "Compare two contracts" / "Coming in v1.2." |
| `export.csv_pdf` | built | — (v1.1 spec) | US-011 | "Export to CSV / PDF" / "Available on Free Trial, Growth and Pro." |
| `reminders.key_dates` | stub | v1.1 | US-017 | "Renewal and expiry reminders" / "Key dates are recorded today; email reminders arrive in v1.1." |
| `crm.hubspot` | stub | Phase 1 | US-016 | "Push key terms to HubSpot" / "Arrives in Phase 1." |
| `crm.salesforce` | stub | Phase 1 | US-016 | "Push key terms to Salesforce" / "Arrives after HubSpot." |
| `esign.docusign` | stub | GA | §3 roadmap v1.2 | "DocuSign hand-off" / "Planned for general availability." |
| `eval.golden_set_instructor` | planned | — | §10 dataset 1 | (operator-only; `user_note` "Internal evaluation dataset.") **Flips to `built`** when `eval/datasets/msa-instructor/pdfs/` holds all 10 PDFs and `manifest.json` exists (spec 22 §8) — v0.2 |
| `eval.hhh_human` | **stub** (5d-3) | v0.2 MEP | §10 HHH | "Expert review mode" / **"Scores are saved; the evaluation-sheet export arrives in Stage 7."** `since='2026-09-22'` |
| `eval.hhh_judge` | stub | after 50 human rows | §10 judge | (internal) |
| `eval.judge_precision` | stub | after 50 human rows | §10 judge | (internal) |
| `eval.redteam` | planned | — | §9 red teaming | (internal) **Flips to `built`** when `eval/redteam/attacks.json` + `redteam.ts` land — **v0.4, with chat** (the PRD's Alpha gate needs it as soon as a chat endpoint exists; "on every deploy" from then on, hardened at v1.0) |
| `eval.foundry_export` | planned | — | §10 exports | (internal) **Flips to `built`** when `eval/export/foundry.ts` lands — v1.0 |
| `observe.guardrail_events` | stub | v1.0 | §11 Observability | (internal) |
| `observe.alerts` | stub | v1.0 | §11 Observability | (internal) |
| `rollout.cohorts` | stub | v1.0 | §5 sampling | (internal) |
| `billing` | planned | GA | §12, A-06 | "Self-service billing" / "Plan changes are handled by our team today." |

Keys marked (internal) carry `owner: 'engineering'` and are **omitted from the `/settings` table** (§3) but returned by the API and shown on the `/trust` page's "How we measure" section (spec 15 §2). `export.csv_pdf` is `built (v1.1 spec)` in the PRD: the registry stores `status: 'built'` and `phase: 'v1.1'` so the table can print both.

**v1.1 5d-3 (2026-09-22) — D53: `eval.hhh_human` is `planned → stub`, not `built`.** Review mode is live on the results page and route 32 writes `hhh_scores` rows, so the capability is no longer `planned` — hiding the toggle would now be hiding something that works. It is not `built` either: the point of the capability is an **evaluation deliverable**, and the sheet export that produces one is Stage 7. `stub` with `stub="children"` states exactly that — the feature renders and saves, with a note naming what is still missing. The `<Capability>` wrapper of §1.4 gets its first `stub="children"` use outside `KeyDatesCard`.

### 1.3 `notImplemented(key)` and the 501 error (P-4)

```ts
export function notImplemented(key: CapabilityKey): AppError {
  const c = getCapability(key);
  if (c.status === 'built') throw new Error(`notImplemented() called for built capability ${key}`);
  return new AppError('NOT_IMPLEMENTED', 501,
    `${c.label} arrives in ${c.phase === '—' ? 'a later release' : c.phase}.`, false,
    { capability: key, phase: c.phase, status: c.status });
}
```

`AppError.toResponse()` (spec 01 §2) is extended to copy `details.capability` and `details.phase` into the envelope for this code only:

```json
{ "error": { "code": "NOT_IMPLEMENTED", "message": "Push key terms to HubSpot arrives in Phase 1.", "retryable": false, "capability": "crm.hubspot", "phase": "Phase 1" } }
```

`NOT_IMPLEMENTED` is the **one new code** the PRD's P-4 asks for; it is added to `error-codes.ts` by spec 01 v1.1 amendment §A.

### 1.4 Client access

`GET /api/capabilities` (§2) is fetched once by the authed shell into TanStack Query (`staleTime: Infinity` — it changes only with a deploy) and exposed by `useCapability(key)` → `{ status, phase, label, user_note }`. Server Components import `CAPABILITIES` directly. **No component reads `process.env` for feature state** — the registry replaces ad-hoc flags for every key above. (`NEXT_PUBLIC_EXPORT_ENABLED` from spec 15 remains the operator kill-switch for export *availability*; the registry states export is `built`.)

`<Capability capability="risk.flag" stub="fallback">` wrapper (P-6): renders `children` when `built`; when `stub`, renders `fallback` (the empty state) by default, or `children` plus `stubNote` when the prop `stub="children"` is given — for stub capabilities whose data layer is live today (`KeyDatesCard`, spec 21 §7.4: dates and offsets work, only delivery is undeployed); and **nothing** when `planned`. Every placeholder panel in specs 20–23 uses it, so the "hidden, not absent" rule has one implementation: `RiskPanel`, `EscalateOffer`, `PlaybookAdmin` use the default; `KeyDatesCard` uses `stub="children"`.

**v1.1 5d-3a (2026-09-22) — the prop is `capability`, not `key`.** Earlier drafts wrote `<Capability key="risk.flag">`. That cannot work: **React reserves `key`** for reconciliation, strips it from `props`, and the component would receive `undefined` — the wrapper would read the registry for no capability at all and, worse, do it silently. The prop is therefore named **`capability`**, and every example above and in specs 07 and 22 now reads `<Capability capability="…">`. The rest of the contract — `stub`, `stubNote`, `fallback`, and the built/stub/planned behaviour — is unchanged. Implemented in `src/components/layout/Capability.tsx` (Stage 5d-3).

---

## 2. `GET /api/capabilities` (route 26, spec 12 v1.1 §A)

Authenticated (`401` to anon). No rate limit. `Cache-Control: private, max-age=3600`.

**200** `{ "generated_at": "<build time ISO>", "commit": "<BUILD_COMMIT>", "capabilities": [ { key, status, phase, prd_ref, since, label, user_note, owner } ] }` — the full map, sorted by key, including internal keys.

---

## 3. `/settings` — "What ContractIQ can do today" (Flow 2 step 3, P-1)

Added below the plan card (spec 03 §11) as a section with `id="capabilities"`, heading **"What ContractIQ can do today"**, intro sentence: "ContractIQ is honest about what it does and doesn't do yet. This list is generated from the same registry the software runs on."

`CapabilityTable` — columns **Capability | Status | Available | Note**, one row per `owner='product'` entry in §1.2, grouped in the order: Upload & import → Analysis → Chat & retrieval → Risk & playbooks → Integrations → Reminders & export → Billing. Status cell renders a `StatusPill`: `built` → green-600 "Available now"; `stub` → yellow-700 "In progress"; `planned` → gray "Planned"; each with an icon and the text, never colour alone. "Available" prints `phase` (or "Now"). One row reads runtime state as well: `export.csv_pdf` prints "Now" only when `publicConfig.exportEnabled` is true; when the operator kill-switch is off it prints "In progress · v1.1" with the note "Export is built and switched on per environment", so the table never claims a feature the UI hides. The table is a plain `<table>` with `<caption>`; sortable by nothing (fixed order), fully keyboard-readable.

**Limitations copy** (PRD §11 Accountability), rendered verbatim above the table and reused by the results page's "About these results" disclosure (spec 16 §6 v1.1 amendment): **"ContractIQ extracts standard NDA and MSA terms from English-language, text-layer PDFs. It does not provide legal advice, does not yet handle scanned PDFs or DOCX, does not support non-English contracts, does not yet flag risks, and may miss highly unusual or bespoke clauses."** The sentence "does not yet flag risks" is rendered only while `risk.flag` is not `built`; the "scanned PDFs or DOCX" clause only while `ingest.ocr` / `ingest.docx` are not `built` — the copy is assembled from the registry so it cannot drift from it.

---

## 4. Integration adapters (P-2) — `src/lib/integrations/<name>/`

Every external integration has `types.ts` (the interface), `null-adapter.ts`, and `index.ts` exporting `get<Name>Adapter()` which returns the vendor adapter when its config is present and the `NullAdapter` otherwise. **Services import only the interface and the getter — never a vendor SDK.**

Shared result type, `src/lib/integrations/types.ts`:

```ts
export type AdapterResult<T> =
  | { ok: true; value: T }
  | { ok: false; reason: 'NOT_CONFIGURED'; capability: CapabilityKey }
  | { ok: false; reason: 'VENDOR_ERROR'; capability: CapabilityKey; message: string; retryable: boolean };
```

`NullAdapter` methods **always** return `{ ok: false, reason: 'NOT_CONFIGURED', capability }` synchronously wrapped in a resolved promise; they never throw and never log contract content.

| Directory | Interface (`types.ts`) | Capability | Config that swaps in a vendor (`.env.example` v1.1 section) |
|---|---|---|---|
| `crm/` | `CrmAdapter { connectUrl(userId): Promise<AdapterResult<{ url }>>; completeConnect(userId, code): Promise<AdapterResult<{ external_account_id, credential_ref }>>; pushKeyTerms(input: { connection: IntegrationConnection, contractId, externalRecordId?, terms: Array<{ term_name, value, page_number, display_rank }> }): Promise<AdapterResult<{ record_id: string }>>; healthcheck(connection): Promise<AdapterResult<void>> }` — **per-user**: `getCrmAdapter(target)` returns the vendor adapter when the app-level OAuth client for that one vendor is configured, and **one vendor at a time is enforced in config**: `serverConfig` (spec 01 v1.1 §B) has a zod `refine` that fails boot when both `CRM_HUBSPOT_CLIENT_ID` and `CRM_SALESFORCE_CLIENT_ID` are set, and `getCrmAdapter()` returns the NullAdapter for the target whose pair is absent (Assumption 16: HubSpot first, Salesforce second); and every call takes the caller's `integration_connections` row (§6a); a user with no row gets `NOT_CONFIGURED` even when the vendor is wired | `crm.hubspot`, `crm.salesforce` | `CRM_HUBSPOT_CLIENT_ID/SECRET`, `CRM_SALESFORCE_CLIENT_ID/SECRET` (the app's OAuth client, one per vendor); user tokens live in Vault, referenced by `integration_connections.credential_ref` |
| `ocr/` | `OcrAdapter { extract(pdf: Buffer): Promise<AdapterResult<{ text: string; pageCount: number; confidence: number /* 0–100 */ }>> }` | `ingest.ocr` | `OCR_PROVIDER=textract\|document_ai`, `OCR_API_KEY`, `OCR_REGION` |
| `docx/` | `DocxExtractor { extract(file: Buffer): Promise<AdapterResult<{ text: string; pageCount: number }>> }` — output must carry `[PAGE N]` markers so nothing downstream changes | `ingest.docx` | `DOCX_INGEST_ENABLED=true` (library-based, no vendor) |
| `esign/` | `EsignAdapter { createEnvelope(contractId, fileBytes): Promise<AdapterResult<{ envelope_id }>>; parseWebhook(body: unknown, signature: string): Promise<AdapterResult<{ envelope_id, status }>> }` | `esign.docusign` | `ESIGN_PROVIDER=docusign`, `ESIGN_WEBHOOK_SECRET` |
| `import/` | `ImportSource { listFiles(token): …; fetchFile(token, fileId): Promise<AdapterResult<Buffer>> }` — one `NullAdapter` shared by the three keys | `import.drive`, `import.dropbox`, `import.sharepoint` | (planned — no config yet; the getter always returns the NullAdapter) |
| `email/` | `EmailAdapter { send(template, to, vars): Promise<AdapterResult<{ sent, failed }>> }` | — (built: wraps the `send-notification` Edge Function, spec 14 §2a) | existing `SMTP_*` |
| `redline/` | `RedlineAdapter { produceRedline(contractId, flags): Promise<AdapterResult<Buffer>> }` | `redline.word` | (planned; NullAdapter only) |
| `graph/` | `KnowledgeGraphAdapter { upsert(contractId, triples): …; query(question): … }` | `retrieval.graph` | (planned; NullAdapter only) |
| `rag/` | `ExternalRagAdapter { answer(input: { contractId, question, history }): Promise<AdapterResult<{ answer: string; cited_pages: number[] }>> }` — the `retrieval.n8n` backend (spec 08 v1.1 §D) | `retrieval.n8n` | `N8N_RAG_WEBHOOK_URL`, `N8N_RAG_TOKEN` |

`email/` is the only adapter with a real implementation at v1.1; every other `index.ts` returns the `NullAdapter` unless its config is set, and **no vendor adapter file exists yet** — wiring one is "one file plus config" (P-2).

### 4.1 Where the adapters are called today

| Call site | Behaviour |
|---|---|
| `POST /api/contracts/upload` step 6 (spec 04 v1.1 §A) | If the magic bytes are `PK\x03\x04` **and** the filename ends `.docx` (case-insensitive): `getDocxExtractor().extract()` → on `NOT_CONFIGURED` return **`422 UNSUPPORTED_FORMAT`** ("Word documents aren't supported yet — export the contract as a PDF and upload that. DOCX support arrives in v1.1."). Any other non-`%PDF-` file remains `400 NOT_A_PDF`. |
| `POST /api/contracts/upload` step 7 (scanned) | When `wordCount < 100`: `getOcrAdapter().extract()` → `NOT_CONFIGURED` ⇒ the existing `422 SCANNED_PDF`. Once configured **and gated** (`ingest.ocr` flips to `built` only after `ocr-accuracy.ts` passes on the ~100-contract labelled sample, §1.2): OCR text replaces the parse output, `contracts.ocr_confidence` is stored, and **`confidence < 80` ⇒ `422 OCR_LOW_CONFIDENCE`** ("This scan is too low-quality to read reliably ({n}% confidence). Please upload a native digital PDF or a clearer scan.") — nothing stored. |
| `POST /api/contracts/{id}/push/{target}` (§5) | `getCrmAdapter(target).pushKeyTerms()` |
| `POST /api/webhooks/esign` (§5) | `getEsignAdapter().parseWebhook()` |
| `chat-service` strategy selection (spec 08 v1.1 §D) | `getExternalRagAdapter()` when `RETRIEVAL_STRATEGY=n8n` |

---

## 5. Placeholder routes owned by this spec (all `501` today — P-4)

| # | Method + path | Key | Contract once built |
|---|---|---|---|
| 27 | `POST /api/contracts/{id}/push/{target}` (`target ∈ hubspot\|salesforce`, else `404`) | `crm.hubspot` / `crm.salesforce` | Body `{}`. Requires `status='completed'` (`409 NOT_PROCESSED`) and a `connected` `integration_connections` row for the caller and target (`409 NOT_CONNECTED` once built). **Automatic trigger (US-016 "after processing"):** `POST /api/contracts/{id}/process` step 11b (spec 06 v1.1) calls `crm-push-service.pushIfConnected(contractId)` for every `connected` connection of the owner, bounded to 3 s within the handler budget and never failing the run; a timeout writes a `failed` event and the results page shows the retry toast. This route is the manual retry. Selects `key_terms WHERE display_rank <= 12` (the 12 default-expanded MSA terms; NDA pushes its 10), calls `pushKeyTerms`. **Idempotent per contract:** the adapter is given `externalRecordId` from the last successful `integration_events` row for `(contract_id, target)`, so a repeat push updates rather than duplicates. Writes one `integration_events` row per attempt (§6) **and one `processing_runs` row `stage='crm_push'`** (`outcome='success'|'error'`, `error_code`) — including on the 501 path today (`outcome='error', error_code='NOT_IMPLEMENTED'`), so component 9 of spec 23 §3 is measurable before the feature exists. **200** `{ status: 'success', record_id, pushed_terms: n }`; `NOT_CONFIGURED` ⇒ `501` (registry stub); `VENDOR_ERROR` ⇒ `502 INTEGRATION_FAILED` (retryable) after writing the failed event. **A failed push never changes `contracts` and never blocks review** — the results page shows a non-blocking toast with Retry. |
| 28 | `POST /api/webhooks/esign` (**public**, signature-verified) | `esign.docusign` | Verifies `ESIGN_WEBHOOK_SECRET` HMAC; writes `integration_events` `target='docusign'`. **501** today, `401 INVALID_SIGNATURE` once built. Excluded from the middleware matcher like `/api/health`. |
| 29 | `GET /api/contracts/{id}/key-dates` | `reminders.key_dates` | Stub status ⇒ **this one route is live** (the table exists and is written, §7): **200** `{ key_dates: [{ id, kind, date, term_id, term_name, reminders: [{ id, offset_days, send_at, status }] }] }`. Empty array when none derived. |
| 30 | `PATCH /api/key-dates/{id}/reminders` | `reminders.key_dates` | `{ "offsets_days": [30, 60, 90] }` (subset of `{30,60,90}`) → replaces the scheduled reminders for that key date. **200**. Live today (writes rows; delivery is the stub). |
| 31 | `POST /api/import/{source}` (`drive\|dropbox\|sharepoint`) | `import.*` | **501** (planned). Route registered so the upload screen's disabled options point at a real path. |
| 35 | `POST /api/integrations/{target}/connect` (`hubspot\|salesforce`) | `crm.*` | **"Connect once" (US-016).** Once built: returns the vendor OAuth `url` (`connectUrl`); the callback `GET /api/integrations/{target}/callback?code=…` calls `completeConnect`, stores the token in Vault (`vault.create_secret`, name `crm_<user_id>_<target>`), and upserts `integration_connections` `{ user_id, target, external_account_id, credential_ref, status='connected' }` — one row per `(user_id, target)`; writes an `integration_events` row `contract_id NULL, direction='pull', status='success'`. **501** today. |
| 36 | `DELETE /api/integrations/{target}` | `crm.*` | **Deletes** the caller's `integration_connections` row on their own JWT (owner DELETE is the only client write RLS grants on this table, §6a) and revokes the Vault secret named by its `credential_ref` through the **admin client** (a sanctioned service-role site, spec 13 v1.1 §C). No `status='disconnected'` update is issued by a client — `status` is written only by the OAuth callback (service role); a later re-connect simply inserts a fresh row. **204**; **501** today. |
| 37 | `GET /api/integrations` | `crm.*` | **Live today:** `200 { connections: [{ target, status, external_account_id, connected_at }] }` — empty until a vendor is built; `/settings` renders a "Connections" card from it with "Connect HubSpot" / "Connect Salesforce" buttons that call route 35 (501 ⇒ toast naming Phase 1). |

Routes 19–25 (risk, escalate, playbooks, compare) are in spec 20 §3; route 26 is §2 above. Spec 12 v1.1 amendment lists all of them.

---

## 6a. `integration_connections` (P-3; `supabase-schema.sql` v1.1 §A6) — the "connect once" record

| Column | Type | Meaning |
|---|---|---|
| `id` | uuid pk | |
| `user_id` | uuid → `profiles` cascade | |
| `target` | text `hubspot|salesforce|docusign|drive|dropbox|sharepoint` | |
| `status` | text `connected|disconnected|error` | |
| `external_account_id` | text null | The vendor account/portal id |
| `credential_ref` | text null | **Vault secret name** (`crm_<user_id>_<target>`) — tokens are never stored in this table |
| `connected_at`, `updated_at`, `created_at` | timestamptz | |

Unique `(user_id, target)`. RLS: owner SELECT and DELETE; INSERT/UPDATE are service-role only (the callback route writes with the admin client after verifying the OAuth `state` belongs to the session user — added to spec 13 §2 site (4) class). Deleting a `profiles` row cascades; the Vault secret is removed by `DELETE /api/account` (spec 11 §3, one more cleanup step) and by route 36 (row DELETE on the owner's JWT + admin-client Vault revoke). `status='disconnected'`/`'error'` are written only by service-role code (the OAuth callback, or a push that receives an auth failure from the vendor, spec 21 §5 route 27).

## 6. `integration_events` (P-3; `supabase-schema.sql` v1.1 §A6)

| Column | Type | Meaning |
|---|---|---|
| `id` | uuid pk | |
| `user_id` | uuid → `profiles` cascade | |
| `contract_id` | uuid null → `contracts` cascade | NULL for account-level events (CRM connect) |
| `target` | text `hubspot|salesforce|docusign|drive|dropbox|sharepoint|n8n` | |
| `direction` | text `push|pull|webhook` | |
| `status` | text `success|failed|not_configured` | `not_configured` rows are written by the 501 path too, so the attempt rate of unbuilt features is observable |
| `external_record_id` | text null | The CRM record id; read back for idempotency |
| `error_code` | text null | |
| `payload_hash` | text null | sha256 of the pushed field map — never the values |
| `created_at` | timestamptz | |

RLS: owner SELECT + INSERT; no UPDATE/DELETE. Index `idx_integration_events_contract_target (contract_id, target, created_at desc)` serves the idempotency lookup. **The 501 path writes a `not_configured` row** on the caller's JWT before throwing, so PRD component 9's "success and failure are written to `integration_events`" holds from day one.

---

## 7. Key-date reminders (US-017, `reminders.key_dates` — stub)

### 7.1 Tables (`supabase-schema.sql` v1.1 §A7)

`key_dates`: `id, contract_id, user_id, term_id (→ key_terms, set null on delete), kind ('end_date'|'renewal_notice_deadline'|'renewal_date'|'auto_renewal_check'), date (date), derived_from (jsonb: the term names and values used), is_manual boolean, created_at, updated_at`. Unique `(contract_id, kind)`.

`reminders`: `id, key_date_id (→ key_dates cascade), user_id, offset_days (30|60|90 CHECK), send_at (timestamptz = date − offset at 08:00 UTC), channel ('email'|'in_app'), status ('scheduled'|'due'|'sent'|'cancelled'), sent_at, created_at`. Unique `(key_date_id, offset_days, channel)`. Index `idx_reminders_due (send_at) WHERE status='scheduled'`.

RLS: owner SELECT/INSERT/UPDATE/DELETE on both (a user configures their own offsets).

### 7.2 Derivation — `src/lib/services/reminder-service.ts` `deriveKeyDates(contractId)`

Runs **after** `persist_key_terms` succeeds — spec 06 v1.1 §B **step 11c**, before the summary claim — and **after** every `PATCH /api/key-terms/{id}` whose `term_name` is **any term in the derivation table for the contract's type** — the four MSA source terms, or `Term & Duration` for an NDA ("editing a term re-derives its key date"). The set is exported as `KEY_DATE_SOURCE_TERMS[contract_type]` from `reminder-service.ts` so the PATCH handler and the derivation share one list. Reads the MSA terms by exact `term_name`:

| `kind` | Source terms (MSA library names) | Rule |
|---|---|---|
| `end_date` | `Contract end date` | `value` parses as `YYYY-MM-DD` ⇒ that date |
| `renewal_notice_deadline` | `Contract end date` + `Notice to not auto renew (Days)` | end date − N days, when both parse |
| `renewal_date` | `Contract end date` + `Renewal Period (Months)` + `Auto Renewal` = `Yes` | end date + N months |
| `auto_renewal_check` | `Auto Renewal` = `Yes` and no `Notice to not auto renew (Days)` | end date − 90 days, so the user is still warned |

NDA contracts derive only `end_date` from `Term & Duration` when it contains a parseable date; otherwise nothing. Unparseable values derive nothing and log `activity_events` `key_date_unparsed` (metadata: `kind` only). Each derived key date upserts on `(contract_id, kind)`, cancels its previous `scheduled` reminders, and inserts the **default offsets 30 / 60 / 90 days** for both channels; a `send_at` in the past is inserted as `cancelled`. A `key_dates` row with `is_manual=true` (user-edited date, built later) is never overwritten by derivation.

**v1.1 5d-2c (2026-09-22) — D52: the renewal rolls forward, anchored on the current term.**

*Evidence.* Live contract `93ba9b49` (Expel, ends 2022-09-21, `Auto Renewal = Yes`, `Renewal Period (Months) = 6`) held `renewal_date = 2023-03-21` and `auto_renewal_check = 2022-06-23`. Read in September 2026, the card offered both as upcoming dates with live reminder toggles. The derivation computed the **first** renewal and stored it; an auto-renewing contract does not renew once.

*Rule.* For an auto-renewing contract with a parseable period, `renewal_date` is the first `end_date + k × period` with **k ≥ 0** that is **not before today**. `auto_renewal_check` and `renewal_notice_deadline` are computed from **that** occurrence. The table above reads:

| `kind` | Rule (5d-2c) |
|---|---|
| `end_date` | unchanged — `value` parses as `YYYY-MM-DD` ⇒ that date |
| `renewal_date` | first `end date + k × period` ≥ today, **k ≥ 0**; without a parseable period, nothing |
| `renewal_notice_deadline` | next renewal − N days when the contract auto-renews; otherwise end date − N days, as before |
| `auto_renewal_check` | next renewal − 90 days when the contract auto-renews; otherwise end date − 90 days |

**k ≥ 0 — the anchor is the end of the CURRENT term.** 5d-2b started the series at k = 1 and was wrong: a contract ending 2027-03-31 renews **on** 2027-03-31, and that is the date the reader must act before. Anchoring on the term after it moved the notice deadline to 2027-03-01 → 2028-03-01, telling a reader their deadline was a year later than it is — the single mistake this date exists to prevent. With k ≥ 0 a contract inside its first term anchors on its own end date, and a contract that has been renewing for years skips the occurrences already behind.

**Month-end clamp.** Adding months clamps to the last day of the target month: 2027-01-31 + 1 month is **2027-02-28**, 2028-01-31 + 1 is **2028-02-29**, 2026-08-31 + 6 is **2027-02-28**. Plain month arithmetic rolls 31 February over into March and moves the renewal past the day the contract renews. Every occurrence is measured from the **end date**, never from the previous occurrence, so a clamp never compounds: 31 January + 2 months is 31 March again. The helper (`addMonthsClamped`) and the series (`nextRenewalOccurrence`) live in `src/lib/services/renewal-schedule.ts` and are shared by the derivation and the read-time roll, so the two cannot drift.

A period of zero or less cannot advance; the end date is returned. A non-auto-renewing contract and an unparseable period are untouched.

*Applied twice, on purpose.* At **derivation**, so newly written reminders target the next occurrence. And at **read time** — `listKeyDates`, shared by route 29 and `GET /api/contracts/{id}`, and the card, both through the pure `rollForwardKeyDates` — because a row derived in March is read in October, by which time the renewal it named may itself have passed. The read path writes nothing back.

*"Passed".* After roll-forward, any key date still behind today is history — typically the original `end_date` of a contract that has been renewing for years. `KeyDatesCard` renders it with a **Passed** tag and **no reminder toggles**: there is nothing left to be reminded about. Reminders whose `send_at` is past remain `cancelled` under the existing rule.

*One row while the term is live (§7.4).* With k ≥ 0, a contract inside its first term has `end_date` and `renewal_date` on the **same day**. Two rows carrying one date read as a data error, so the card renders a single row — **"Term ends and auto-renews · {date}"** — keeping the reminder toggles. Once the dates differ (the contract has renewed at least once) the rows separate again into "Contract ends" (usually `Passed`) and "Renews on".

*Stage 10 — the missing cron.* Rolling forward on read keeps the UI honest, but it does not **schedule** anything: reminders still exist only for the occurrence current at the last derivation, and nothing re-derives a contract that nobody opens. Scheduling reminders beyond the next occurrence needs a periodic job that walks auto-renewing contracts and re-derives them as each renewal passes. That job is a **Stage 10 item** and is deliberately **not** built here — no cron or schema change is made by 5d-2b or 5d-2c.

### 7.3 Scheduler stub — pg_cron + `send-notification`

- `supabase-schema.sql` v1.1 §A7 schedules **`mark-due-reminders`** daily at `08:00 UTC`: `update public.reminders set status='due' where status='scheduled' and send_at <= now()` — pure SQL, always scheduled.
- Delivery is the **undeployed** part: the Edge Function `supabase/functions/send-due-reminders/index.ts` (written, not deployed) selects `status='due'`, and for `channel='email'` calls `send-notification` with the new template **`key_date_reminder`** (subject "Reminder: {file_name} — {kind label} on {date}", body naming the contract, the term it came from and a link to `/contracts/{id}`; no term values beyond the date), then sets `status='sent', sent_at=now()`. The cron line that invokes it is present but **commented out exactly like `purge-expired-pdfs`** until the function is deployed.
- In-app: `ReminderBell` in the authed shell shows `reminders WHERE channel='in_app' AND status IN ('due','sent') AND sent_at > now() - interval '30 days'` — live today, because the `due` flip is pure SQL. Clicking a reminder opens `/contracts/{id}` and the term row (`?term={term_id}`).

`key_date_reminder` is added to the `send-notification` template union (spec 14 v1.1 amendment).

### 7.4 UI — `KeyDatesCard` on the results page (below the key-terms panel; `<Capability capability="reminders.key_dates" stub="children">` — the live card renders while stub, with the footer note as `stubNote`)

Lists each key date with its kind label ("Contract ends", "Last day to stop auto-renewal", "Renews on", "Auto-renewal check"), the date, a `PageChip` to the source term, and three toggles **30 / 60 / 90 days before** → route 30. Footer while stub: "Email reminders arrive in v1.1 — in-app reminders are shown in the bell today." Empty state: "No key dates were found in this contract."

---

## 8. Upload screen — disabled options naming their phase (Flow 3 step 1, P-6)

`ImportSourceOptions`, rendered above `PdfDropzone` in `/contracts/new` (spec 04 v1.1 §A): a row of five `aria-disabled` option buttons — **Google Drive**, **Dropbox**, **SharePoint** (each "Planned for v1.1"), **Word (.docx)** ("Coming in v1.1"), **Scanned / photo** ("Coming in v1.2") — each with `aria-describedby` pointing at its phase text, non-focusable-activatable (Enter/Space does nothing, the phase text is read), and a "See what ContractIQ can do today" link to `/settings#capabilities`. The dropzone helper text adds: "Text-layer PDF only for now." Each button reads its phase from the registry entry, not a literal.

---

## 9. Tests

- `tests/unit/capabilities.test.ts` — the map contains exactly the 36 keys in §1.2 with the stated statuses; `notImplemented()` throws for a `built` key; every 501 route module's key (enumerated by grep over `src/app/api/**/route.ts` for `notImplemented(`) is `stub` or `planned`; the limitations sentence drops "does not yet flag risks" when `risk.flag` is stubbed to `built`.
- `tests/integration/capabilities.test.ts` — `GET /api/capabilities` returns 401 anonymously and the full sorted list with a session.
- `tests/integration/placeholders-integrations.test.ts` — routes 27, 28, 31, 35, 36 return `501` with the right key; route 37 returns an empty `connections` array; B cannot read A's `integration_connections`; A cannot insert one directly; route 27 writes one `integration_events` row with `status='not_configured'`; route 28 is reachable without a session; **processing** a fixture MSA whose stubbed extraction returns `Contract end date = 2027-03-31`, `Notice to not auto renew (Days) = 30`, `Auto Renewal = Yes`, `Renewal Period (Months) = 12` yields **three** `key_dates` rows — `end_date`, `renewal_notice_deadline`, `renewal_date` (`auto_renewal_check` is not derived because the notice term is present, §7.2) — and 18 reminders (3 × 3 offsets × 2 channels) **with no edit** (spec 06 step 11c); **5d-2c:** with the fixture's end date still ahead, `renewal_date` is the end date itself (`2027-03-31`, k = 0) and `renewal_notice_deadline` is `2027-03-01`, and the card shows the two as one **"Term ends and auto-renews"** row; a second fixture identical but **without** `Notice to not auto renew (Days)` yields `end_date`, `renewal_date`, `auto_renewal_check` (also three rows), the check falling `2026-12-31` (90 days before `2027-03-31`); routes 29–30 then read/modify them; a derivation error (stubbed) leaves `status='completed'` and the terms intact; editing `Contract end date` re-derives and cancels the old reminders; on an NDA fixture, editing `Term & Duration` to a value containing `2027-06-30` re-derives `end_date` and cancels its previous reminders, while editing `Governing Law` triggers nothing; `offsets_days: [45]` is rejected `400`.
- `tests/unit/null-adapters.test.ts` — every `NullAdapter` returns `NOT_CONFIGURED` with its capability key and never throws; the getter returns the NullAdapter when config is absent.
- `tests/integration/upload-formats.test.ts` — a `.docx` upload returns `422 UNSUPPORTED_FORMAT` with the exact message; a renamed `.docx` with a `.pdf` extension returns `400 NOT_A_PDF`; a scanned PDF still returns `422 SCANNED_PDF` while OCR is unconfigured; with a stubbed OCR adapter returning `confidence: 72` the upload returns `422 OCR_LOW_CONFIDENCE` and stores nothing; `confidence: 91` stores `ocr_confidence=91`.
- `tests/e2e/placeholders.spec.ts` (P-6) — `/settings` shows the "What ContractIQ can do today" table with the `risk.flag` row reading "In progress · Phase 1"; `/contracts/new` shows the five disabled options with their phase text and none is activatable; the results page shows `KeyDatesCard` with three offset toggles.
- `tests/rls/placeholders.test.ts` — B cannot read A's `integration_events`, `key_dates`, `reminders`; A cannot update `integration_events`.
