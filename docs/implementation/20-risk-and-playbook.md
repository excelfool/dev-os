# 20 — Risk & Compliance Flags, Playbooks and Escalations (placeholders)

**Requirements:** PRD v1.1 US-013 (P0, stub), US-014 (P1, stub); §3 components 5, 6, 7 and their risk rows; §3 L2 "Risk-detection F1 … SKIPPED until US-013 is built"; §3 dependency "Majority-agreement risk labels"; §3 internal risk "Risk flags shipped without agreed ground truth"; §4 Flow 3 step 5 (Risk panel empty state), step 8 ("High risk — recommend human/legal review"); §4 agent table rows "Playbook loader", "Risk & Compliance agent", "Escalation router", "Comparison agent" (HIL only); §8 "Risk flagging" prompt row; §9 risk-layer guardrail and harmless rule 4; §10 dataset 5; §11 Launch "risk F1 ≥ 90% if US-013 is enabled, else US-013 stays hidden"; Appendix A P-3, P-4, P-5, P-6, P-7; Appendix B `playbook.manage`, `risk.flag`, `risk.escalate`, `compare.contracts`.
**Engineering doc:** unchanged v1.0; the delta list `docs/engineering/delta-v1.1.md` rows Comp 5/6/7, US-013, US-014, Harmless rule 4, L2 Risk F1, Playbook loader, Risk & Compliance agent, Escalation router, Comparison agent, `risk.flag`, `risk.escalate`, `playbook.manage`, `compare.contracts`.
**Status:** every artefact in this file is a **placeholder in the P-1…P-7 sense** — typed, tested, observable, and honest about not working. Nothing here calls the model. The capability keys are `playbook.manage` (stub, Phase 1), `risk.flag` (stub, Phase 1), `risk.escalate` (stub, Phase 1), `compare.contracts` (stub, v1.2). Registry entries live in spec 21 §1.

---

## 1. What "stub" means for this feature

| Layer | Exists today | Behaviour today | What flips it to `built` |
|---|---|---|---|
| Tables (P-3) | `playbooks`, `playbook_rules`, `risk_flags`, `escalations` in `supabase-schema.sql` v1.1 §A1–A4, RLS on, seeded default MSA playbook | Readable by the owner; no code writes `risk_flags` or `escalations` | The risk prompt (§6) and majority-agreement labels (spec 22 §1 dataset 5) |
| Routes (P-4) | `POST /api/contracts/{id}/risks`, `POST /api/contracts/{id}/escalate`, `GET/POST/PATCH /api/playbooks…`, `POST /api/contracts/{id}/compare` | `501 NOT_IMPLEMENTED` with the capability key (spec 12 v1.1 §A) | Registry status change + handler body |
| UI (P-6) | `RiskPanel`, `EscalateOffer`, `PlaybookAdmin`, `HighRiskLabel` | `RiskPanel` renders the empty state naming Phase 1; `PlaybookAdmin` reachable only by URL, read-only; `HighRiskLabel` never rendered | `capabilities['risk.flag'].status === 'built'` |
| Eval (P-5) | `eval/runners/risk-f1.ts` | Emits `{ metric: 'risk_f1', status: 'SKIPPED', reason: 'US-013 not built; no majority-agreement labels' }` | Dataset 5 present **and** `risk.flag` built |
| Review completion | `POST /api/contracts/{id}/complete` | Unchanged | Once built: refuses with `409 HIGH_FLAGS_UNDECIDED` while any `risk_flags.severity='High'` row has `decision IS NULL` (§4.3) |

---

## 2. Data model (owned by `supabase-schema.sql` v1.1 §A1–A4; explained here)

### 2.1 `playbooks` — one active playbook per contract type per workspace

| Column | Type | Meaning |
|---|---|---|
| `id` | uuid pk | |
| `user_id` | uuid null → `profiles` | **NULL = system default** (the seeded MSA playbook). At MVP a "workspace" is one user (no multi-user roles, spec 13 §1), so `user_id` is the workspace key. |
| `contract_type` | text `NDA|MSA` | |
| `name` | text | e.g. "Default MSA playbook (instructor examples)" |
| `version` | integer ≥ 1 | Bumped on every rule change (§2.2); **recorded on every flag** as `risk_flags.playbook_version` |
| `is_active` | boolean | Exactly one active per `(user_id, contract_type)` — partial unique index `playbooks_one_active_per_type` |
| `is_default` | boolean | True only on the seeded row |
| `source` | text `seed|upload|in_app` | Where the rules came from |
| `created_at`, `updated_at` | timestamptz | `set_updated_at` trigger |

### 2.2 `playbook_rules` — versioned rules

| Column | Type | Meaning |
|---|---|---|
| `id` | uuid pk | |
| `playbook_id` | uuid → `playbooks` cascade | |
| `user_id` | uuid null | Denormalised from the playbook (NULL for the seed) so RLS is a single predicate |
| `rule_key` | text | Stable machine key, unique per playbook (`msa.one_sided_indemnity`) |
| `rule_type` | text `presence|absence|threshold|pattern` | **PRD US-014's four values, verbatim.** `presence` = a clause must exist; `absence` = a clause must *not* exist, or must exist only when a trigger is present (the DPA/BAA rules); `threshold` = a numeric term compared against a limit; `pattern` = free-text criterion judged by the model against the cited clause |
| `term_name` | text null | The library term the rule reads (`Net payment terms (Net 30, 45, 60, 75, 90, other)`) — NULL for clause-level rules |
| `condition` | jsonb | Rule-type-specific (§2.3) |
| `severity` | text `High|Medium|Low` | |
| `rationale` | text | Plain-language "why this matters", shown on the flag verbatim |
| `version` | integer | Copy of `playbooks.version` at the time the rule row was written; a rule edit inserts a new row at the new version and sets `superseded_at` on the old one — rows are never updated in place |
| `superseded_at` | timestamptz null | |
| `created_at` | timestamptz | |

Only rows with `superseded_at IS NULL` on the active playbook are "active rules". `PlaybookAdmin` (once built) shows parsed rules for **human confirmation before activation** (PRD agent table "Playbook loader"): upload/parse writes rows with `is_active=false` on a new playbook version; activation is a separate explicit action.

### 2.3 `condition` shapes

```jsonc
// threshold
{ "op": ">", "value": 60, "unit": "days", "parse": "net_days" }   // Net 75 -> 75 > 60
// presence
{ "clause": "termination_for_convenience", "expect": true }
// absence (conditional): flag when `trigger` is found and `required` is not
{ "trigger": "personal_data_language", "required": "data_processing_agreement" }
// pattern
{ "criterion": "Indemnity obligations run in one direction only (customer indemnifies provider with no reciprocal obligation)." }
```

### 2.4 The seeded default MSA playbook (PRD US-014, R-15) — inserted by `supabase-schema.sql` v1.1 §A2, idempotent on `rule_key`

| `rule_key` | `rule_type` | `term_name` | `condition` | severity | rationale (verbatim on the flag) |
|---|---|---|---|---|---|
| `msa.one_sided_indemnity` | `pattern` | `Customer Indemnity` / `Service Provider indemnity` (both read) | `{"criterion":"Indemnity obligations run in one direction only — one party indemnifies the other with no reciprocal obligation.","also_read":["Service Provider indemnity"]}` | High | "One-sided indemnity means you carry the other side's legal costs and losses with nothing in return. Ask for a mutual indemnity or a cap." |
| `msa.no_termination_for_convenience` | `presence` | `Termination for convenience (Yes, No, N/A)` | `{"clause":"termination_for_convenience","expect":true}` (flag when the term value is `No` or `N/A`) | High | "Without termination for convenience you cannot exit the agreement early unless the other side breaches it. Ask for a notice-based exit." |
| `msa.payment_terms_over_60_days` | `threshold` | `Net payment terms (Net 30, 45, 60, 75, 90, other)` | `{"op":">","value":60,"unit":"days","parse":"net_days"}` | Medium | "Payment terms longer than 60 days delay your cash flow and are outside the usual Net 30–60 range. Ask for Net 30 or Net 45." |
| `msa.missing_dpa_with_personal_data` | `absence` | — | `{"trigger":"personal_data_language","required":"data_processing_agreement"}` | High | "The contract handles personal data but has no Data Processing Agreement. Under GDPR a DPA is required whenever personal data is processed on your behalf." |
| `msa.missing_baa_with_phi` | `absence` | — | `{"trigger":"phi_language","required":"business_associate_agreement"}` | High | "The contract mentions protected health information but has no Business Associate Agreement. HIPAA requires a BAA before PHI is shared." |

Trigger and clause vocabularies (`personal_data_language`, `phi_language`, `data_processing_agreement`, `business_associate_agreement`, `termination_for_convenience`) are the phrase lists in `src/lib/ai/playbook-vocab.ts` (§6.2) — deterministic pre-checks that decide whether the model is asked at all.

### 2.5 `risk_flags`

| Column | Type | Meaning |
|---|---|---|
| `id` | uuid pk | |
| `contract_id` | uuid → `contracts` cascade | |
| `user_id` | uuid → `profiles` cascade | |
| `rule_id` | uuid → `playbook_rules` | The rule that produced it |
| `playbook_version` | integer | Version recorded on every flag (US-014) |
| `verdict` | text `broken|satisfied|not_applicable` | Only `broken` rows are shown as flags; the others are kept for the eval runner |
| `severity` | text `High|Medium|Low` | Copied from the rule at flag time |
| `page_number` | integer null | Clause citation — page |
| `source_sentence` | text null | Clause citation — verbatim span, verified with `containsNormalised` exactly like `key_terms.source_sentence`; unverifiable ⇒ `is_source_verified=false` and confidence capped at 49 |
| `is_source_verified` | boolean | |
| `why_this_matters` | text | One sentence from the model, prefixed to the rule's `rationale` on screen |
| `confidence_score` | integer 0–100 | Same conversion as key terms (A-04) |
| `requires_human_review` | boolean | **Always `true` when `severity='High'`** (DB CHECK) |
| `decision` | text null `accept|dismiss` | The human decision; NULL = undecided |
| `decided_at` | timestamptz null | |
| `was_wrong` | boolean default false | "this flag was wrong" — writes the correction-queue row (§4.4) |
| `prompt_version` | text | |
| `created_at` | timestamptz | |

### 2.6 `escalations`

| Column | Type | Meaning |
|---|---|---|
| `id` | uuid pk | |
| `contract_id` | uuid → `contracts` cascade | |
| `user_id` | uuid → `profiles` cascade | |
| `trigger` | text `chat_unresolved|high_flag|user_request|comparison_new_high` | The four HIL triggers in the PRD agent table |
| `session_id` | uuid null → `chat_sessions` | For `chat_unresolved` |
| `risk_flag_id` | uuid null → `risk_flags` | For `high_flag` |
| `unresolved_turns` | integer null | The count that fired the offer (§5.1) |
| `note` | text null ≤ 1,000 | User's message to the reviewer |
| `status` | text `open|closed` | **A human closes every escalation** — `closed_by` is set by an operator with the service role; no client path can close |
| `closed_by` | uuid null | |
| `closed_at` | timestamptz null | |
| `created_at` | timestamptz | |

### 2.7 RLS (spec 02 v1.1 amendment §A)

| Table | SELECT | INSERT | UPDATE | DELETE |
|---|---|---|---|---|
| `playbooks` | own **or `user_id IS NULL`** (the seed is readable by everyone) | own | own | own |
| `playbook_rules` | own or `user_id IS NULL` | own | — (rows are versioned, never updated) | own |
| `risk_flags` | own | own | own (decision / was_wrong only — enforced in the handler; RLS grants the row) | — |
| `escalations` | own | own | — (closing is service-role only) | — |

---

## 3. Routes — all return `501 NOT_IMPLEMENTED` today (P-4)

Every handler follows the spec 01 §8 skeleton (session → ownership → …) **before** returning 501, so the API contract is testable and an unauthenticated caller still gets `401`, a non-owner `404`. The envelope is the standard one with the capability key in `details`:

```json
{ "error": { "code": "NOT_IMPLEMENTED", "message": "Risk flags arrive in Phase 1 — this contract was not checked against a playbook.", "retryable": false, "capability": "risk.flag", "phase": "Phase 1" } }
```

Implementation: `throw notImplemented('risk.flag')` — a helper in `src/lib/capabilities.ts` (spec 21 §1.3) that reads `phase` from the registry and builds the `AppError`. **A route may only call `notImplemented()` for a key whose registry status is `stub` or `planned`**; a unit test enumerates every 501 route and asserts its key is not `built`.

| # | Method + path | Key | Contract once built |
|---|---|---|---|
| 19 | `POST /api/contracts/{id}/risks` | `risk.flag` | Body `{}`. Resolves the active playbook as: the caller's own `is_active` playbook for `contract_type` if one exists, **else** the seeded default (`user_id IS NULL`) — so for MSA a playbook is always found and `404 NO_ACTIVE_PLAYBOOK` is reachable only for NDA until an NDA seed or user playbook exists. Runs §6 over it; replaces the contract's `risk_flags`; **200** `{ contract_id, playbook_id, playbook_version, flags: [{ id, rule_key, severity, verdict, page_number, source_sentence, is_source_verified, why_this_matters, rationale, confidence_score, requires_human_review, decision }] }`. Errors `409 NOT_PROCESSED`, `404 NO_ACTIVE_PLAYBOOK`, plus the AI errors of spec 06. Rate limit bucket `risks`, 10/hr. Telemetry: one `processing_runs` row `stage='risk'` per call (`duration_ms`, `outcome`, `error_code`) — component 5–6 of spec 23 §3 — plus the `openai_calls` `purpose='risk'` rows. |
| 20 | `PATCH /api/risk-flags/{id}` | `risk.flag` | `{ "decision": "accept"|"dismiss" }` or `{ "was_wrong": true }`. Sets `decided_at`. **200** the row. `400 INVALID_DECISION`. |
| 21 | `POST /api/contracts/{id}/escalate` | `risk.escalate` | `{ "trigger": "chat_unresolved"|"high_flag"|"user_request", "session_id"?, "risk_flag_id"?, "note"? ≤ 1000 }`. Inserts an `escalations` row `status='open'`. **201** `{ id, status: "open", created_at }`. `409 ESCALATION_OPEN` if one is already open for the contract. |
| 22 | `GET /api/playbooks` | `playbook.manage` | **200** `{ playbooks: [{ id, contract_type, name, version, is_active, is_default, rule_count }] }` — includes the seed. |
| 23 | `POST /api/playbooks` | `playbook.manage` | `{ contract_type, name, rules: [{ rule_key, rule_type, term_name?, condition, severity, rationale }] }` → creates version 1, `is_active=false`. **201**. `400 INVALID_RULE` with a field map. |
| 24 | `PATCH /api/playbooks/{id}` | `playbook.manage` | `{ "is_active": true }` (activation after human confirmation) or `{ rules: [...] }` (bumps `version`, supersedes changed rules). **200**. |
| 25 | `POST /api/contracts/{id}/compare` | `compare.contracts` | `{ "other_contract_id": "uuid" }` (same `contract_type`). **200** `{ diffs: [{ term_name, left, right, changed }], new_high_risk: [...] }`; any newly introduced High-risk clause also creates an `escalations` row with `trigger='comparison_new_high'`. `400 TYPE_MISMATCH`. |

`NOT_IMPLEMENTED` is added to the error taxonomy in spec 01 v1.1 amendment §A (HTTP 501, `retryable: false`); the four route-specific codes above (`NO_ACTIVE_PLAYBOOK`, `INVALID_DECISION`, `ESCALATION_OPEN`, `INVALID_RULE`, `TYPE_MISMATCH`, `HIGH_FLAGS_UNDECIDED`) are registered there now so the taxonomy is complete before the feature is.

---

## 4. UI (P-6)

All four components live in `src/components/risk/` and read the registry through `useCapability(key)` (spec 21 §1.4). **Rule:** `status === 'planned'` ⇒ the component returns `null`; `stub` ⇒ the empty state; `built` ⇒ the real UI.

### 4.1 `RiskPanel` — results page, right column, **below the summary block and above the key-terms panel**

- **Stub (today):** a card headed "Risk & compliance flags" with the body: **"Risk flags arrive in Phase 1. ContractIQ will check each contract against your playbook and cite the clause behind every flag."** and a "What ContractIQ can do today" link to `/settings#capabilities`. `aria-label="Risk flags — not yet available"`. No spinner, no button.
- **Built:** one `RiskFlagRow` per `verdict='broken'` flag, sorted High → Medium → Low then page. Row: `SeverityBadge` (High red-600 + icon "alert-triangle", Medium yellow-700 + "info", Low gray + "circle") | rule name | `PageChip` (same `goToPage(page, source_sentence)` as key terms) | `ConfidenceBadge` | expandable "Why this matters" (the model's `why_this_matters` sentence, then the rule `rationale`, then the verbatim `source_sentence` quote block) | decision controls.
- **`HighRiskLabel`:** rendered on every `severity='High'` row, exact text **"High risk — recommend human/legal review"** (PRD Flow 3 step 8, §9 risk-layer guardrail). Colour is never the only channel (icon + text).
- Every flag is framed "informational, not legal advice" by the existing `DisclaimerBanner` that is always above the panels (spec 07 §1); the panel footer repeats: "Flags are informational and not legal advice."
- Decision controls on High rows: **Accept** / **Dismiss** buttons → `PATCH /api/risk-flags/{id}`; a decided row shows "Accepted"/"Dismissed" with the timestamp. A "This flag was wrong" link (all severities) → `{ was_wrong: true }` and the row is greyed with "Thanks — logged for review".
- Empty state once built and no flags: "No playbook rules were broken. {n} rules checked against {playbook name} v{version}."

### 4.2 `EscalateOffer` — chat panel (spec 08 v1.1 amendment §C)

- **Stub:** after the third unresolved turn (§5.1) a muted note under the last assistant bubble: **"A human reviewer hand-off arrives in Phase 1."** — informational only, no button.
- **Built:** the same slot shows "Not getting what you need? **Ask a human reviewer**" → opens a dialog with an optional note (≤ 1,000 chars) → `POST /api/contracts/{id}/escalate` with `trigger='chat_unresolved'` → toast "Sent — a reviewer will follow up." The assistant text itself is unchanged; the offer is a UI affordance, not model output, so the model never promises an action it cannot take (PRD: "takes no action on the contract").

### 4.3 Review completion and High flags (once built)

`POST /api/contracts/{id}/complete` (spec 10 §1) gains one guard, active only when `capabilities['risk.flag'].status === 'built'`: if any `risk_flags` row for the contract has `severity='High' AND decision IS NULL`, return `409 HIGH_FLAGS_UNDECIDED` — "Decide on each High-risk flag before marking the review complete." `CompleteReviewButton` is disabled with that helper text while such rows exist. This is the executable form of "every High flag requires a human decision (accept / dismiss) before the review is marked complete".

### 4.4 "This flag was wrong" — the correction queue

Setting `was_wrong=true` makes the row visible in the `risk_flag_corrections` view (`supabase-schema.sql` v1.1 §A4, `security_invoker`), the risk analogue of `term_corrections`: `(flag id, rule_key, playbook_version, severity, prompt_version, contract_type, feedback_opt_in)`. It feeds the failure pool `eval/failures/` (spec 22 §7) and the prompt review, exactly like term corrections.

### 4.5 `PlaybookAdmin` — `/settings/playbooks` (route file `src/app/(app)/settings/playbooks/page.tsx`)

- **Stub (today):** **no nav link** (the "hidden" in US-014); the route exists and renders the seeded default MSA playbook **read-only** — a table of the five rules (rule, type, severity, rationale) under the heading "Default MSA playbook — read-only until Phase 1", with the empty-state sentence "Playbook editing and upload arrive in Phase 1." No inputs, no upload control.
- **Built:** per contract type: the active playbook and version; "Upload playbook" (`.json` in the §3 route-23 shape, or CSV `rule_key,rule_type,term_name,condition,severity,rationale`) → parsed rules shown in a confirmation table with an **"Activate v{n}"** button (human confirmation before activation) → `PATCH /api/playbooks/{id}` `{ is_active: true }`; inline rule editor for `in_app` playbooks. Activating one playbook deactivates the previous for that type (the partial unique index enforces one active).

---

## 5. Behavioural rules shared with other specs

### 5.1 "~3 unresolved turns" (PRD Flow 4 step 7, harmless rule 4) — the counter

Defined once, in `src/lib/services/chat-service.ts` (spec 08 v1.1 amendment §C): an assistant turn is **unresolved** when its content is the exact "I cannot find this in the document." fallback **or** `citation_verified=false` **or** it is the rule-3 off-scope reply. `unresolved_turns` = the number of **consecutive** unresolved assistant turns ending at the latest one, computed from the session's last 6 messages; it resets to 0 on any resolved answer. When `unresolved_turns ≥ 3`, the `POST /api/contracts/{id}/chat` response carries `"escalation_offer": true` and the client renders `EscalateOffer`. The number is also recorded in `activity_events` `chat_message_sent` metadata (`unresolved_turns`) so the escalation rate (spec 23 §3 "Intent resolution") is measurable before the route is built.

### 5.2 Trigger sources for `escalations.trigger`

| Trigger | Fired by |
|---|---|
| `chat_unresolved` | `EscalateOffer` after §5.1 |
| `high_flag` | `RiskFlagRow` "Ask a reviewer" link on a High flag (built only) |
| `user_request` | The chat composer's "/human" slash command or the "Ask a human reviewer" footer link in the chat panel (built only) |
| `comparison_new_high` | Route 25 |

---

## 6. Risk-flagging prompt (specified now, executed only once `risk.flag` is built)

### 6.1 `src/lib/ai/prompts/risk.v1.ts` — conditional chain-of-thought per rule (PRD §8)

Composition, fixed order:
1. Role: "You check one contract against a list of playbook rules. For each rule decide `broken`, `satisfied` or `not_applicable` using only the document text. Cite the page and copy the clause verbatim. Never give legal advice; explain in one sentence why the rule matters for the reader."
2. The active rules as `- {rule_key} [{rule_type}, {severity}]: {criterion or condition rendered in words}`; for `threshold` rules the extracted term value is included so the model confirms rather than recomputes.
3. Output contract (JSON mode):
```json
{ "flags": [ { "rule_id": "uuid", "verdict": "broken|satisfied|not_applicable",
               "severity": "High|Medium|Low", "page_number": 1,
               "source_span": "verbatim", "why_this_matters": "one sentence",
               "confidence": 0.0 } ] }
```
4. Grounding rules identical to extraction: 1-indexed page from the nearest `[PAGE N]`; `source_span` verbatim; exactly one object per rule.
5. The user message is the full `contracts.contract_text`.

Settings: GPT-4o, JSON mode, temperature 0.1, `max_tokens` 1500, `purpose='risk'` (added to `openai_calls.purpose`), one JSON-repair retry, same 24 s in-handler deadline as `/process`. Cost ≈ $0.09 per call — **outside** the ≤ $0.25 per-analysis budget as written, so the route is rate-limited separately and its cost is reported as its own line (`purpose='risk'`) in the daily rollup; folding it into the per-contract budget is a launch decision recorded in spec 19 §P.

### 6.2 Deterministic pre-checks — `src/lib/ai/playbook-vocab.ts`

`threshold` rules never reach the model: `parseNetDays("Net 75") = 75`, compared in code. `absence` rules ask the model only when the trigger phrase list matches the document (`personal_data_language`: "personal data", "personally identifiable", "PII", "data subject", "GDPR"; `phi_language`: "protected health information", "PHI", "HIPAA", "covered entity"); if the trigger is absent the verdict is `not_applicable` with no call. `presence` rules for a library term read the term's value first (`No`/`N/A` ⇒ `broken` candidate) and ask the model only to cite the clause.

### 6.3 Post-processing

Identical pipeline to spec 06 §4: zod parse (`riskFlagSchema`), confidence ×100, page range check, `containsNormalised` source verification with the 49 cap, `requires_human_review = severity === 'High'`, `playbook_version` from the active playbook, `prompt_version` stamped. Persisted through `persist_risk_flags(contract_id, playbook_id, flags jsonb)` (`supabase-schema.sql` v1.1 §A5) — the same one-statement-transaction pattern as `persist_key_terms`, so partial flag sets can never survive.

---

## 7. Eval — `eval/runners/risk-f1.ts` (P-5)

```ts
// Emits exactly one report row.
// If eval/datasets/risk-labels/ is absent OR capabilities['risk.flag'].status !== 'built':
//   { metric: 'risk_f1', status: 'SKIPPED', target: '>= 0.90',
//     reason: 'US-013 not built; no majority-agreement risk labels' }
// Otherwise: precision/recall/F1 of predicted `broken` flags vs labelled flags,
// keyed (contract_id, rule_key); a label counts only when `agreement >= 2 of 3`.
```

Dataset 5 layout (spec 22 §1): `eval/datasets/risk-labels/<contract_id>.json` = `{ contract_id, playbook_version, labels: [{ rule_key, verdict, reviewers: ["r1","r2","r3"], votes: { broken: 2, satisfied: 1 }, agreement: 2 }] }`. `run-all.ts` includes the runner from day one so the report always shows the `risk_f1` row (SKIPPED today) — "never PASS on an unmeasured metric".

Launch condition (PRD §11 GA row): `risk_f1 ≥ 0.90` **if** `risk.flag` is enabled; otherwise the registry keeps it `stub` and `RiskPanel` stays in its empty state. Spec 18 v1.1 amendment §B carries the gate.

---

## 8. Tests

- `tests/integration/placeholders-risk.test.ts` — every route in §3 returns `401` without a session, `404` for another user's contract, and otherwise `501` with `error.code='NOT_IMPLEMENTED'` and the right `capability` key; no `risk_flags`, `escalations` or `playbooks` row is written by any of them.
- `tests/rls/placeholders.test.ts` (extends spec 02 §8) — B cannot read A's `playbooks`, `playbook_rules`, `risk_flags`, `escalations`; **both** A and B can read the seeded playbook (`user_id IS NULL`) and neither can update or delete it; A cannot set `escalations.status='closed'` (no UPDATE policy); a `risk_flags` insert with `severity='High', requires_human_review=false` is rejected by the CHECK.
- `tests/unit/playbook-seed.test.ts` — the seed contains exactly the five `rule_key`s in §2.4 with the stated `rule_type` and severity; `parseNetDays` maps `Net 30/45/60/75/90/Other/N/A` to `30/45/60/75/90/null/null`.
- `tests/unit/unresolved-turns.test.ts` — three consecutive fallbacks ⇒ 3; fallback, answer, fallback ⇒ 1; `citation_verified=false` counts as unresolved.
- `tests/unit/risk-panel.test.tsx` — with the registry stubbed to `stub` the empty state text renders and no row/button exists; with `planned` the component renders nothing; with `built` the High row shows the exact "High risk — recommend human/legal review" label and Accept/Dismiss.
- `tests/e2e/placeholders.spec.ts` (P-6) — on a completed contract the results page shows the Risk panel empty state naming Phase 1; `/settings/playbooks` shows the read-only seed and no upload control; no nav link to it exists.
- `tests/unit/eval-risk-f1.test.ts` — with no dataset the runner emits a single `SKIPPED` row and never `PASS`; with a fixture of 3 labelled contracts and `built` stubbed it computes F1 correctly, ignoring labels with `agreement < 2`.
