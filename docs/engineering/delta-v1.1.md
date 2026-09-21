# Engineering doc — delta against PRD v1.1
Generated 2026-09-21 by engineering-reviewer (delta mode). Source of truth: docs/ContractIQ_PRD.md v1.1. The engineering doc itself is unchanged; this file is the NEEDS REVISION list that Stage 2 specs 20–23 and the amendments to specs 03/04/08/17 will close.

---

# ContractIQ engineering-doc delta review — PRD v1.1 vs `docs/engineering/engineering-doc.md` (v1.0)

Files reviewed in full:
- `/Users/teodorsimeonov/dev-os/docs/ContractIQ_PRD.md` (v1.1, 2026-09-21, 1027 lines)
- `/Users/teodorsimeonov/dev-os/docs/engineering/engineering-doc.md` (v1.0, 1379 lines; header still cites PRD v1.0, 24 June 2026)

Status key: COVERED = engineering doc addresses it technically; PARTIAL = addressed but a v1.1 element is missing or contradicted; MISSING = no coverage at all. Where a v1.1 requirement appears in several PRD places (e.g. US-009 and Flow 3 step 6), it is counted once under its primary ID and cross-referenced, so the totals are not inflated.

| ID | Requirement | Status | Evidence or gap |
|---|---|---|---|
| **Header / personas / metrics** | | | |
| HDR-1 | PRD header: source of truth is v1.1 (2026-09-21) | PARTIAL | Eng doc header (line 5) cites "v1.0, 24 June 2026"; nothing in the doc references R-1…R-34, Appendix A/B or v1.1 |
| §2 Paralegal persona | "Paralegal / Small Legal Team (first-pass triage)" persona; justifies HIL, playbooks, Review mode, High-flag rule | MISSING | Eng §3 lists only Founder/Ops, Freelancer, Anonymous, Operator, Legal SME; no paralegal/triage persona, no Review-mode workflow |
| NS | North Star = "Number of contracts processed with review completed, WoW"; target +15% WoW, ≥4/user/month; tracked via `contracts` + `activity_events` | PARTIAL | Eng §1 success criteria still names "North Star — upload → review complete ≤ 15 min" (the v1.0 North Star, now L1 time-to-clarity). `review_completed_at` + `activity_events` exist and ≥4/user is listed, but the WoW count definition and +15% WoW target are absent |
| L1 Time-to-clarity | ≤ 15 min upload → review complete | COVERED | Eng §1 row 1, `contracts.created_at` → `review_completed_at`; §4.3 "North Star timer" |
| L1 Task completion rate | ≥ 85% of started reviews reach "review complete" via `activity_events` funnel | PARTIAL | `activity_events` event types exist (§7.10) but no funnel query, no ≥85% target anywhere in §1/§10/App. B |
| L1 % helpful | 60/70/80 by stage from `hhh_scores` | MISSING | No `hhh_scores` table, no HHH metric in §1, §7, §10, §13 |
| L1 % honest | 75/85/90 by stage from `hhh_scores` | MISSING | Same |
| L1 % harmless (% harmful) | <5/<3/<2 by stage from `hhh_scores` | MISSING | Same |
| L1 NPS | ≥ 40, in-app survey at session end | COVERED | §7.11 `nps_responses`, §9.13, §4.3 |
| L1B Cost per contract | ≤ $0.25 (extraction ≤ $0.20) via `openai_calls` | COVERED | §1, §7.9, §8.2, §8.5 |
| L2 Extraction F1 | ≥88 NDA / ≥85 MSA, floor 82, `npm run eval` | COVERED | §1, §13 AI/eval row |
| L2 Risk-detection F1 | ≥90% vs majority-agreement labels; `eval/runners/risk-f1.ts` emits SKIPPED | MISSING | No risk runner, no SKIPPED convention in §11 folder tree or §13 |
| L2 Page attribution | ≥92% | COVERED | §13, §14 page-accuracy eval |
| L2 Calibration | ±10% | COVERED | §1, §8.2 |
| L2 Time to first term | ≤30s P95 via `processing_runs` | COVERED | §1, §7.2 `first_term_ready_ms`, §7.8 |
| L2 30-day retention | ≥45% | COVERED | §1 via `activity_events` |
| L2 Correction rate | ≤12% | COVERED | §7.14 view, §13 alert |
| **Nine components (§3)** | | | |
| Comp 1 | Email/document intake: drag-drop built; `import.drive/dropbox/sharepoint` planned | PARTIAL | Drag-drop covered (§4.3, `PdfDropzone`); no import.* capability entries, no disabled options naming phase |
| Comp 2 | PDF→text built; `ingest.docx`, `ingest.ocr` stubs; OCR <80% ⇒ re-upload | PARTIAL | pdf-parse + `[PAGE N]` covered (§4.3, §7.2); OCR only as a v1.2 feature row (§10 Phase 3) — no `OcrAdapter`/`NullAdapter`, no `contracts.ocr_confidence`, no <80% rule, no DOCX extractor interface |
| Comp 3 | Classify contract type; soft warning on mismatch | COVERED | §4.3 step 6, `detected_type`, `type_mismatch_warning`, `TypeMismatchNotice`, App. A-14 |
| Comp 4 | Extract key terms: 36-term MSA library with question/answer_format/display_rank; NDA 10 unchanged | PARTIAL | Eng §1, §4.3, §8.2, §10 v0.2 all specify the retired **12-term MSA list**; `term-library.ts` has no `question`/`answer_format` fields; PRD §8 36-term table not reflected anywhere |
| Comp 5 | Check terms vs playbook (US-014 stub, `playbook.manage`) | MISSING | No playbook tables, routes, components or service |
| Comp 6 | Rank risks (US-013 stub, `risk.flag`) | MISSING | No `risk_flags`, no `RiskPanel`, no risk prompt |
| Comp 7 | Decide / escalate; human decides every High flag; `risk.escalate` | MISSING | No `escalations` table, no escalate route |
| Comp 8 | Summary and Q&A: chat built; summary planned/first build item; `qa.cross_contract` planned | PARTIAL | Chat fully covered (§4.4, §8.3, §9.10). Summary (`extract.summary`, `contracts.summary_md`) absent; cross-contract Q&A not registered |
| Comp 9 | Push to CRM (US-016 stub) | MISSING | No `CrmAdapter`, `integration_events`, push route |
| Cross-cutting Auth | Supabase Auth infrastructure | COVERED | §4.1, §6.2 |
| Cross-cutting Feedback | `user_feedback`, corrections, `hhh_scores` | PARTIAL | `user_feedback` + `term_corrections` covered (§7.7, §7.14); `hhh_scores` absent |
| Comp 2 architecture note | Text extracted once at upload, stored in `contract_text`; Storage non-blocking | COVERED | §4.3, §6.2, §7.2, §7.15 |
| **Roadmap & dependencies (§3)** | | | |
| v0.1 Foundation | + all DB tables incl. placeholder tables (P-3) + capability registry (P-1) | PARTIAL | Foundation items covered (§10 v0.1); placeholder tables and registry absent |
| v0.2 MEP | Human-review acceptance: eval on instructor 10-contract MSA golden set; SME answers HHH on ≥50 term rows; F1 ≥82% and rows in `hhh_scores` | MISSING | §10 v0.2 has no MEP acceptance row; §13 eval datasets are CUAD + SME 30/20 only; no instructor golden set, no `hhh_scores` |
| v0.3 Enriched | + Contract summary (US-015) | PARTIAL | Other v0.3 items covered (§10 v0.3); summary absent |
| v0.4 Chat & History | + query-enhancement step; inline editing of value, page and reasoning | PARTIAL | Chat/history/value-editing covered; query enhancer and page/reasoning editing absent |
| v1.0 Launch | + red-team suite every deploy; `guardrail_events` + alert rules (stub); rollout cohorts (stub) | PARTIAL | Security audit, WCAG, rate limiting, tooltips covered (§10 v1.0); red-team, `guardrail_events`, `alert_rules`, cohorts absent |
| v1.1 Post-launch | + DOCX ingestion (stub→built); key-date reminders (US-017) | PARTIAL | CSV/PDF export, batch, analytics covered (§10 Phase 2); DOCX and reminders absent |
| v1.2 Growth | OCR with <80% ⇒ re-upload; `compare.contracts` stub; `esign.docusign` stub | PARTIAL | OCR/comparison/email/workspace listed (§10 Phase 3) but no <80% rule, no stub routes, no DocuSign |
| v2 Iteration | Playbook auto-generation; cross-contract Q&A; vector/graph retrieval; industry risk libraries; fine-tune | PARTIAL | §2.3 v2 lists fine-tune + chunked RAG + non-US few-shot only |
| Dependency: instructor golden set | PDFs into `eval/datasets/msa-instructor/pdfs/` before v0.2 acceptance | MISSING | §11 folder tree `eval/datasets/` = "CUAD subset, 30 NDA + 20 MSA" |
| Dependency: majority-agreement risk labels | 2–3 reviewers before US-013 ships | MISSING | Not in §3 personas (Legal SME annotates 30+20 only), §13 or §10 |
| External dep: OCR vendor | NullAdapter until configured; ~100-contract labelled sample | MISSING | Not in §6/§8/§10 |
| External dep: CRM vendor APIs | `CrmAdapter` interface; NullAdapter; one vendor at a time | MISSING | Not present |
| External dep: OpenAI pricing | provider-neutral `LlmProvider` fallback | COVERED | §8.5 Provider fallback |
| Internal risk: re-baselining after 36-term library | Re-run eval on instructor set; report old/new F1 with matcher version; never compare across libraries | MISSING | No matcher version field in §13 report schema; no re-baseline step |
| Internal risk: risk flags without ground truth | `risk-f1` stays SKIPPED | MISSING | See L2 Risk F1 |
| **User flows (§4)** | | | |
| Flow 1 | Landing → sign-up → dashboard empty state | COVERED | §4.1 |
| Flow 2 step 3 | `/settings` renders capability registry "What ContractIQ can do today" (P-1) | MISSING | §5.2 `/settings` = plan/quota, opt-in, deletion only |
| Flow 3 step 1 | Import (Drive/Dropbox/SharePoint), DOCX, scanned images shown as disabled options naming their phase (P-6) | MISSING | §4.3 upload step has no disabled placeholder options |
| Flow 3 step 4 | 4-step progress indicator incl. "step 3: summarising" | PARTIAL | §4.3 and `ProcessingSteps` specify a 3-step indicator |
| Flow 3 step 5 | Right panel: summary above terms; Risk panel with empty state naming phase | MISSING | §5.3 results page has no summary block and no `RiskPanel` |
| Flow 3 step 6/9 | Edit value, page citation, reasoning; "Why?" shows source_sentence **and** reasoning | (counted under US-009 / FR-04) | — |
| Flow 3 step 8 | "not found in this contract" for absent terms; "High risk — recommend human/legal review" label once US-013 ships | PARTIAL | "Not found in document" with 0% badge covered (§5.4 Empty); High-risk label absent (US-013) — counted here once |
| Flow 3 step 10 | Review mode: SME answers HHH questionnaire per term → `hhh_scores` | MISSING | No Review mode component, no `hhh_scores` |
| Flow 4 step 2 | Query-enhancement step rewrites `contract` questions (built, R-22) | MISSING | §8.3 has classifier only; no enhancer prompt/module; §8.5 trade table's "candidate for the query enhancer" also absent |
| Flow 4 step 7 | Offer escalation after ~3 unresolved turns; `POST /api/contracts/{id}/escalate` stub | (counted under Harmless rule 4) | — |
| **User stories** | | | |
| US-001 | Auth ≤10s, redirect, clear errors | COVERED | §4.1, §10 v0.1, §14 |
| US-002 | Upload ≤10 MB, ≤30s P95, ≥80% standard terms | COVERED | §4.3, §9.1, §10 v0.2 |
| US-003 | Page number per term; click scrolls viewer | COVERED | §4.3, §10 v0.3, `PageChip` |
| US-004 | Confidence 0–100%, <50 warning | COVERED | §5.3 `ConfidenceBadge`, §8.4 |
| US-005 | Custom terms with same structure "(value, page, confidence, **reasoning**)" | PARTIAL | Custom terms fully covered (§4.3, §7.4, §9.2) except the `reasoning` field, which does not exist in the schema |
| US-006 | Inline PDF viewer, scroll/zoom, clickable highlights | COVERED | §4.3, §10 v0.3, §13 rendering harness |
| US-007 | Chat ≤15s, grounded, page citation | COVERED | §4.4, §8.3, §9.10 |
| US-008 | Dashboard history, clickable rows | COVERED | §4.2, §9.5 |
| US-009 | Edit value, page number **and reasoning**; each ≤2s; `original_ai_value`, `original_ai_page`, `original_ai_reasoning` preserved | PARTIAL | §7.3/§9.8 support value only; no `original_ai_page`/`original_ai_reasoning` columns; PATCH body accepts only `value` |
| US-010 | Thumbs + comment → `user_feedback` | COVERED | §7.7, §9.12 |
| US-011 | Export CSV/PDF ≤5s | COVERED | §9.16, §10 Phase 2 |
| US-012 | Persistent chat history | COVERED | §7.5–7.6, §9.9 |
| US-013 | Risk & compliance flags: severity, citation, "why this matters", confidence, absence rules, High ⇒ human decision, "this flag was wrong" → correction queue; until built: `POST /api/contracts/{id}/risks` 501 `risk.flag`, `RiskPanel` empty state, `risk_f1` SKIPPED | MISSING | Nothing in §5, §7, §8, §9, §10, §11 |
| US-014 | Playbook management: `playbooks`, `playbook_rules` (rule_type presence/absence/threshold/pattern, severity, rationale, versioned), seeded default MSA playbook, `PlaybookAdmin` hidden, routes 501 `playbook.manage` | MISSING | Nothing present |
| US-015 | Contract summary: one GPT-4o call, ≤200 words, obligations per party, `contracts.summary_md`, `[Page X]` per factual sentence, ≤10s P95, ≤$0.03, scored in `hhh_scores` | MISSING | No summary column, prompt, call, or cost/latency budget; `openai_calls.purpose` CHECK lacks `summary` |
| US-016 | CRM push: `CrmAdapter`/`NullAdapter` `NOT_CONFIGURED`, display_rank ≤12 terms, idempotent, `integration_events`, `POST /api/contracts/{id}/push/{target}` 501 | MISSING | Nothing present |
| US-017 | Key-date reminders: `key_dates`, `reminders`, 30/60/90 days, email + in-app, `pg_cron` + `send-notification` Edge Function, re-derive on edit | MISSING | Only `purge-expired-pdfs` Edge Function exists |
| **Functional requirements** | | | |
| FR-01 | Supabase Auth email/password | COVERED | §6.2 |
| FR-02 | 10 MB / 20 pages; DOCX returns 422 `UNSUPPORTED_FORMAT` until `ingest.docx` built | PARTIAL | Limits covered (§9.1); DOCX is folded into `400 NOT_A_PDF` — no `UNSUPPORTED_FORMAT` code, no `ingest.docx` reference |
| FR-03 | Text at upload, `[PAGE N]`, never re-download | COVERED | §4.3, §7.2, §9.4 |
| FR-04 | Panel columns; "Why?" shows `source_sentence` **and** `reasoning` | PARTIAL | `WhySection` shows source sentence only (§5.3); no `reasoning` column in `key_terms` (§7.3), prompt schema (§8.2) or `/process` response (§9.4) |
| FR-05 | ≥5 custom terms, `is_manual` | COVERED | §7.4, §9.2 |
| FR-06 | PDF viewer or text-viewer fallback, both honour `targetPage` | COVERED | §4.3, §5.3, §9.7 |
| FR-07 | Click page → scroll + highlight | COVERED | §4.3 |
| FR-08 | Chat sends question + full text | COVERED | §8.3 |
| FR-09 | Messages saved with role/timestamp | COVERED | §7.6 |
| FR-10 | Dashboard totals, breakdown, sortable list | COVERED | §4.2, §9.5 |
| FR-11 | <50% warning, never hidden | COVERED | §8.4 |
| FR-12 | Feedback stored | COVERED | §7.7 |
| FR-13 | RLS on all tables **including placeholder tables (P-3)** | PARTIAL | RLS on every existing table covered (§7); no placeholder tables exist to carry it |
| FR-14 | Single paste-and-run SQL incl. bucket + Storage policies | COVERED | §7 intro, §7.15 (will need extending once placeholder tables are added) |
| **Agent table (§4)** | | | |
| Ingestion & OCR agent | PDF built; DOCX/OCR stub; HIL: <100 words today; OCR <80% ⇒ reject once OCR ships | PARTIAL | PDF path and <100-word rule covered (§9.1); DOCX/OCR stub and <80% trigger absent |
| Contract-type classifier | `detected_type`; mismatch ⇒ soft warning | COVERED | §4.3, §7.2 |
| Extraction agent | Output incl. `reasoning`; HIL: <50% ⇒ ⚠️; required field (parties, start date) not found ⇒ flag for review | PARTIAL | Schema lacks `reasoning`; no "required field missing ⇒ flag for review" trigger (null value renders 0% badge, but no required-field concept) |
| Confidence Evaluator | 0–100 always shown | COVERED | §8.2, §8.4 |
| Summariser | Summary with `[Page X]`, `contracts.summary_md` | MISSING | See US-015 |
| Playbook loader | Versioned `playbook_rules`; parsed rules confirmed by human before activation | MISSING | See US-014 |
| Risk & Compliance agent | Suggests; human decides every High flag | MISSING | See US-013 |
| Contract Chat agent | + enhanced query; ~3 unresolved turns ⇒ offer escalation; takes no action | PARTIAL | Grounded Q&A, "cannot find", no-action clause covered (§8.3); enhancer and escalation offer absent |
| Comparison agent | Clause-level diff; new High-risk clause ⇒ flagged; stub v1.2 (`compare.contracts` 501) | PARTIAL | Comparison view listed in §10 Phase 3; no stub route, no HIL trigger, no registry entry |
| CRM pusher | Push failure ⇒ notice, retry, never blocks | MISSING | See US-016 |
| Reminder scheduler | 30/60/90 reminders; re-derive on edit | MISSING | See US-017 |
| Escalation router | `escalations` row; human closes every escalation | MISSING | No table/route |
| Feedback Logger | Rating, `term_corrections`, `hhh_scores` | PARTIAL | Rating + corrections covered; `hhh_scores` absent |
| **Constraints (§5)** | | | |
| Perf: summary ≤10s P95 | | MISSING | No summary |
| Perf: all other latency targets | ≤30s e2e, ≤30s first term, ≤15s chat, ≤20s call, ≤2s edit, ≤5s export, ≤10s auth | COVERED | §1, App. B |
| Upload/document constraints | 10 MB/20 pages/15k tokens; <100 words; NDA/MSA English; ≤5 custom | COVERED | App. B (DOCX/OCR declaration counted under FR-02) |
| Cost | ≤$0.25 incl. summary ≤$0.03 | COVERED (summary portion counted under US-015) | §8.2, §8.5 |
| Scalability | 100 concurrent; 1,000 users | COVERED | §6.2, §13 k6 |
| Sampling: ≥200 scored samples/week per stage; cohorts 1–2% → 2–10% → GA | | MISSING | §10 staged gates use "≤ 50 users" for beta; no sample-rate sizing |
| Sampling: `profiles.rollout_cohort` flag (stub) | | MISSING | §7.1 `profiles` has no such column |
| Sampling: 20% human-scored, judge scores rest once gated | | MISSING | No judge, no HHH |
| Reliability & security | 99.5%, signed URLs 1h, non-blocking Storage, AES-256/TLS 1.3, RLS | COVERED | App. B (placeholder-table RLS counted under FR-13) |
| Usability & compliance | WCAG AA, tooltips, 90-day retention, manual delete, GDPR erasure, DPA, no training, `user` param | COVERED | §4.5, §5.4, §8.1, App. B |
| **Technical requirements (§6)** | | | |
| Backend: planned routes return 501 with capability key (P-4) | | (counted under P-4) | — |
| Integrations layer: interface + NullAdapter per integration (P-2) | | (counted under P-2) | — |
| `LlmProvider` with `model.extraction`, `model.chat`, `model.judge` configurable separately (R-31) | | PARTIAL | §8.5 has a provider-neutral `LlmProvider` with one model id (`OPENAI_MODEL` env var); no per-purpose model configuration, no judge model |
| Eval suite: every §10 metric has a runner; unmeasurable ⇒ SKIPPED (P-5) | | (counted under P-5) | — |
| Model requirements: max_tokens 3,000 extraction (36-term MSA) / 1,000 chat / 500 summary; temperature 0.2 summary | | PARTIAL | §8.1 specifies `max_tokens` **2000** for extraction (insufficient for 36 terms plus reasoning) and has no summary column |
| Model requirements: judge model separate and stronger, never in product prompt | | MISSING | Not in §8 |
| Model-choice trade table (R-31): GPT-4o / cheaper model / stronger judge with accuracy-latency-cost | | MISSING | Not in §8 |
| **Grounding strategy (§7)** | | | |
| Single source of truth; extraction grounding; chat grounding; conversation memory; "not found" | | COVERED | §8.2, §8.3 (reasoning counted under FR-04) |
| `RetrievalStrategy` interface: `full-context` built, `vector-rag` stub with `contract_chunks` (`vector` column), `graph-rag` planned | | MISSING | §8.3 hard-codes full context; §2.2 defers chunked RAG with no interface or table |
| **Prompt strategy (§8)** | | | |
| Extraction prompt asks each term's question with answer_format (R-21c) | | PARTIAL | §8.2 prompt composition passes term names only; no question/answer_format |
| Confidence scoring embedded | | COVERED | §8.2 |
| Reasoning field embedded (R-16) | | (counted under FR-04) | — |
| Custom term zero-shot | | COVERED | §8.2 step 3 |
| Summary prompt | | (counted under US-015) | — |
| Risk flagging prompt (conditional CoT per rule) | | (counted under US-013) | — |
| Error recovery JSON retry | | COVERED | §8.1, §8.2 |
| Prompt library versioning; monthly A/B; correction trigger | | COVERED | §8.5, §13 |
| Failure-seeded few-shot pool `eval/failures/` (R-23) | | MISSING | Not in §8.5 or §11 tree |
| **Guardrails & harmless policy (§9)** | | | |
| Extraction-layer guardrails | Confidence, <50 warning, source sentence, not-found/N/A, temp 0.1, calibration | COVERED | §8.4 |
| Chat-layer guardrails | Doc-only prompt, `[Page X]`, "Based on the document…", hallucination test | COVERED | §8.4 |
| UI guardrails | Inline correction, auto-highlight, disclaimer | COVERED | §8.4 (page/reasoning edit counted under US-009) |
| Harmless rule 1 | No profanity/hate/abuse in or out; outbound screen; `guardrail_events` | MISSING | No content screen, no `src/lib/security/guardrails.ts` in §11 tree |
| Harmless rule 2 | No competitor disparagement | MISSING | Not present |
| Harmless rule 3 | Stay within contract; "I can only answer about this contract" + rephrase offer; prompt-injection screen (question and document) logged | PARTIAL | Document-only prompt covered (§8.3); no injection screen, no logging, no explicit off-scope reply/offer |
| Harmless rule 4 | Escalate after ~3 unresolved turns / High flag / user request; `POST /api/contracts/{id}/escalate` → `escalations` (501 stub) | MISSING | Not present |
| Harmless rule 5 | Never solicit personal information | MISSING | Not present |
| Red teaming (R-29) | `eval/redteam/` seed set every deploy; `harmless.redteam_pass_rate` gate | MISSING | Not in §11 tree, §13 CI pipeline or §10 gates |
| **Evaluation strategy (§10)** | | | |
| Dataset 1: instructor 10-contract MSA golden set (primary) | | (counted under Dependency) | — |
| Dataset 2: CUAD subset | | COVERED | §11, §13 |
| Dataset 3: synthetic corpus (6 NDA + 4 MSA), provenance README | | MISSING | Not mentioned |
| Dataset 4: SME 30 NDA + 20 MSA | | COVERED | §3, §13 |
| Dataset 5: majority-agreement risk labels | | (counted under Dependency) | — |
| Dataset 6: user-corrected terms + HHH rows (opt-in) | | PARTIAL | Corrections via `term_corrections` + `feedback_opt_in` covered (§7.14); HHH rows absent |
| HHH questionnaire H1 | not solving the specific problem | MISSING | No 29-code schema, no `hhh_scores` boolean columns |
| H2 | too verbose | MISSING | Same |
| H3 | misses key information | MISSING | Same |
| H4 | extracted as per question asked | MISSING | Same (question-based prompt also absent) |
| H5 | information complete | MISSING | Same |
| H6 | enough for conclusive decision | MISSING | Same |
| H7 | associated red flags covered | MISSING | Same |
| H8 | all information for relevant clause captured | MISSING | Same |
| H9 | correctly favouring one party | MISSING | Same |
| H10 | AI reasoning covers all aspects | MISSING | Same; `reasoning` field also absent |
| H11 | display area highlights relevant clause | MISSING | Highlight mechanism exists (§5.3) but no scoring column |
| O1 | fabricated / non-factual | MISSING | Same |
| O2 | cited source incorrect / unverifiable | MISSING | `is_source_verified` exists but no scoring column |
| O3 | cited links/quotes non-existent | MISSING | Same |
| O4 | extracted from all relevant clauses | MISSING | Same |
| O5 | page number correct | MISSING | Page-accuracy eval exists but no per-response HHH row |
| O6 | reasoning discusses relevant clause | MISSING | Same |
| O7 | related provisions highlighted on page click | MISSING | Same |
| O8 | correct contract in stitched document | MISSING | Same |
| O9 | stays within document scope | MISSING | Same |
| A1 | harmful content | MISSING | Same |
| A2 | solicits personal information | MISSING | Same |
| A3 | reveals internal information | MISSING | Same |
| A4 | shares company's demerits | MISSING | Same |
| A5 | free from misleading claims | MISSING | Same |
| A6 | avoids generic/non-contract questions | MISSING | Same |
| A7 | reasoning free of insensitive/illegal justification | MISSING | Same |
| A8 | prevents false claims about entities | MISSING | Same |
| A9 | blocks hateful/profane content | MISSING | Same |
| `hhh_scores` table + sheet-compatible export | contract_id, term_id/message_id, evaluator human/llm-judge, one boolean per code, pillar verdicts, judge model, prompt version | MISSING | No table in §7, no export |
| LLM-as-judge (R-26) | `hhh-judge.ts`, `judge-precision.ts`, P/R ≥0.70 gate, SKIPPED until 50 human rows, re-measure on change | MISSING | Not in §11 tree or §13 |
| Eval plan: F1, page, calibration, custom-term F1, chat groundedness, e2e latency, satisfaction | | COVERED | §13 |
| Eval plan: risk F1 / HHH human / HHH judge / judge P/R / red-team rows | | (counted above) | — |
| Monitoring: every metric row PASS/FAIL/SKIPPED, never PASS when unmeasurable | | (counted under P-5) | — |
| Monitoring: weekly drift check incl. human-vs-judge overlap | | PARTIAL | §13 weekly drift on 10 corrected terms covered; human-vs-judge comparison absent |
| Eval report with `Prompt_Version` + matcher version | | PARTIAL | `Prompt_Version` covered (§13); matcher version not in report schema |
| Foundry JSONL export `eval/export/foundry.jsonl` (R-32) | | MISSING | Not present |
| **Production readiness (§11)** | | | |
| HHH evaluation table: weekly scoring on H1–H11 / O1–O9 / A1–A9; 36-term overwhelm mitigated by display_rank ≤12 | | PARTIAL | display_rank ≤12 default-expanded covered (§7.3); weekly HHH scoring absent |
| Launch stage: Internal Alpha | Source sentences **and reasoning** shown; disclaimer; red-team seed set passes | PARTIAL | §10 Alpha gate covers flow, extraction, source sentence, disclaimer; reasoning and red-team absent |
| Launch stage: Measurement launch (1–2%) | Helpful ≥60 / Honest ≥75 / Harmful <5; ≥200 samples/week; ≥50 human `hhh_scores` rows; F1 ≥82; correction ≤20; satisfaction ≥75; 0 misleading; latency ≤45s | PARTIAL | §10 "Measurement Beta (≤50 users)" covers the L2 gates thoroughly; HHH floors, cohort %, sample sizing and 50-row criterion absent |
| Launch stage: Beta launch (2–10%) | Helpful ≥70 / Honest ≥85 / Harmful <3; F1 ≥85/82; correction ≤15; calibration ≤0.15; judge P/R ≥0.70; red-team 100% | PARTIAL | No separate Beta stage in §10 (only Alpha → Measurement → Public); none of these thresholds appear |
| Launch stage: Launch (GA) | Helpful ≥80 / Honest ≥90 / Harmful <2; page accuracy ≥92 at gate; risk F1 ≥90 if US-013 enabled else hidden; other go criteria | PARTIAL | §10 Public Launch covers F1, calibration, correction, latency, security, Pro, DPA, disclaimer; HHH floors, page-accuracy gate and risk-F1 condition absent |
| Four-reference threshold rationale (model ceiling / customer floor / competitor / policy) | | MISSING | Not in §10 |
| Observability: Cost per session/user/task | `openai_calls` (tokens, cost_usd, user_id, contract_id, purpose) | COVERED | §7.9 |
| Observability: Time per task | `processing_runs` + `chat_messages.latency_ms` | COVERED | §7.8, §7.6 |
| Observability: Error rate per component | `processing_runs.stage` + `error_code`; extend `stage` to name component 1–9 | PARTIAL | `stage` CHECK is upload/text_extract/ai_extract/persist/total — not component-named; no chat/summary/risk stages |
| Observability: Wrong guardrail triggers | `guardrail_events` (rule, input_hash, action, false_positive) | MISSING | No table |
| Observability: Wrong tool calls | reported SKIPPED | MISSING | No SKIPPED row / runner |
| Observability: Task adherence | `activity_events` funnel | COVERED | §7.10 |
| Observability: Intent resolution | `chat_messages.query_class` + escalation rate | PARTIAL | `query_class` covered (§7.6); escalations absent |
| Observability: Content safety | `guardrail_events` + `hhh_scores` A-codes | MISSING | Neither table |
| Observability: HHH alert thresholds | `alert_rules` + nightly job → `alert_events` | MISSING | Only the 80% budget alert and 12% correction alert exist as ad-hoc jobs; no rules table |
| Observability: Budget | 80% monthly OpenAI budget alert | COVERED | §6.2, §8.5 |
| Responsible AI — Accountability: HIL paths per agent, escalation route | | PARTIAL | Extraction/chat HIL covered; risk, comparison, CRM, reminders, escalation absent |
| Responsible AI — Accountability: limitations incl. "does not yet flag risks"; registry at `/settings` | | PARTIAL | §8.6 limitations copy is v1.0 text (no risk/DOCX line); registry absent |
| Responsible AI — Transparency: benchmarks incl. HHH percentages, matcher + prompt version on trust page | | PARTIAL | §5.2 `/trust` publishes F1 + calibration only |
| Responsible AI — Transparency: disclosures (disclaimer, confidence, source + reasoning, attribution, registry) | | PARTIAL | Disclaimer/confidence/source/attribution covered (§8.4); reasoning and registry absent |
| Responsible AI — Fairness | Underrepresented groups, plan, monthly segmented audit | COVERED | §8.6, §13 |
| Responsible AI — Reliability & Safety: injected instructions screened and logged to `guardrail_events`; health monitoring via `guardrail_events`, `alert_rules` | | PARTIAL | Bad-input, recovery, incident comms covered (App. B); injection screen/log absent |
| **Assumptions (§13)** | | | |
| Assumptions 1–14 | | COVERED | App. A / App. B trace each |
| Assumption 15 OCR vendor / 16 CRM vendor / 17 judge model | | (counted under External deps / judge) | — |
| **Appendix A — Placeholder principle** | | | |
| P-1 | `src/lib/capabilities.ts` typed registry; `GET /api/capabilities`; `/settings` table | MISSING | Not in §9 API, §11 tree, §5.2 |
| P-2 | Interface + `NullAdapter` per integration under `src/lib/integrations/<name>/` returning `NOT_CONFIGURED` | MISSING | No `integrations/` directory |
| P-3 | Placeholder tables in `database.sql` with RLS and `-- capability:` comment | MISSING | §7 has 13 tables + 1 view, none placeholder (`playbooks`, `playbook_rules`, `risk_flags`, `escalations`, `key_dates`, `reminders`, `integration_events`, `hhh_scores`, `guardrail_events`, `alert_rules`, `alert_events`, `contract_chunks` all absent) |
| P-4 | Planned routes registered, return `501 NOT_IMPLEMENTED` with capability key; new `AppError` code | MISSING | §6.2 error taxonomy has no `NOT_IMPLEMENTED`; §9 lists no 501 routes |
| P-5 | Runner + `SKIPPED` row per unmeasurable metric | MISSING | §11 `eval/runners/` has five runners, no SKIPPED convention |
| P-6 | Planned panels exist behind `capabilities.<key>.status !== 'planned'` with empty state; E2E asserts hidden state | MISSING | No hidden panels, no E2E assertion |
| P-7 | Spec per placeholder under `docs/implementation/` | MISSING | §14 mapping has no placeholder rows |
| **Appendix B — Capability registry** | | | |
| `ingest.pdf_text` | built | COVERED | §4.3, §9.1 |
| `ingest.docx` | stub: extractor interface, 422 `UNSUPPORTED_FORMAT` | MISSING | See FR-02 |
| `ingest.ocr` | stub: `OcrAdapter`, `NullAdapter`, `contracts.ocr_confidence` | MISSING | OCR only as v1.2 feature text |
| `import.drive` / `import.dropbox` / `import.sharepoint` | planned, registry only | MISSING | No registry |
| `classify.contract_type` | built | COVERED | `detected_type` |
| `extract.key_terms` | built; R-21 36-term library | PARTIAL | 12-term library (see Comp 4) |
| `extract.summary` | planned, first build item | MISSING | See US-015 |
| `playbook.manage` | stub | MISSING | See US-014 |
| `risk.flag` | stub: `risk_flags`, 501, hidden `RiskPanel`, `risk-f1.ts` SKIPPED | MISSING | See US-013 |
| `risk.escalate` | stub: `escalations`, 501 | MISSING | See Harmless rule 4 |
| `redline.word` | planned | MISSING | No registry |
| `qa.single_contract` | built | COVERED | §8.3 |
| `qa.cross_contract` | planned | MISSING | No registry |
| `retrieval.full_context` | built | COVERED | §8.3 |
| `retrieval.query_enhancer` | planned, first build item | MISSING | See Flow 4 step 2 |
| `retrieval.vector` | stub: `contract_chunks`, strategy class | MISSING | See RetrievalStrategy |
| `retrieval.graph` | planned | MISSING | No registry |
| `retrieval.n8n` | stub: external-backend adapter, config URL, 501 when unset | MISSING | Not present |
| `compare.contracts` | stub: route 501 | PARTIAL | v1.2 feature listed; no stub route |
| `export.csv_pdf` | built (v1.1 spec) | COVERED | §9.16 |
| `reminders.key_dates` | stub: `key_dates`, `reminders`, cron stub | MISSING | See US-017 |
| `crm.hubspot` / `crm.salesforce` | stub: `CrmAdapter`, `integration_events`, 501 | MISSING | See US-016 |
| `esign.docusign` | stub: webhook route 501 | MISSING | Not present |
| `eval.golden_set_instructor` | planned, first build item | MISSING | See Dependency |
| `eval.hhh_human` | planned: `hhh_scores`, export | MISSING | See `hhh_scores` |
| `eval.hhh_judge` | stub: runner SKIPPED | MISSING | See judge |
| `eval.judge_precision` | stub: runner SKIPPED | MISSING | See judge |
| `eval.redteam` | planned, first build item | MISSING | See Red teaming |
| `eval.foundry_export` | planned: JSONL exporter | MISSING | See Foundry |
| `observe.guardrail_events` | stub: table | MISSING | See Observability |
| `observe.alerts` | stub: `alert_rules`, nightly job | MISSING | See Observability |
| `rollout.cohorts` | stub: `profiles.rollout_cohort` | MISSING | See Sampling |
| `billing` | planned, registry only | PARTIAL | Deferral is documented (App. A-06, plan/quota enforcement) but no registry entry |

## Verdict

**NEEDS REVISION.**

- **PARTIAL: 50**
- **MISSING: 104** (of which 29 are the individual HHH questionnaire codes H1–A9, 7 are P-1…P-7, and 27 are capability-registry keys)
- COVERED: remaining rows (all v1.0-era functional requirements, flows and NFRs remain intact)

Recurring root causes behind most gaps (for the planner's benefit, not design proposals):
1. No placeholder infrastructure (P-1…P-7) — this alone cascades into ~40 MISSING rows (registry, 501 routes, NullAdapters, placeholder tables, SKIPPED runners, hidden panels).
2. No `reasoning` field in the extraction schema/DB/UI/edit path — drives US-005, US-009, FR-04, Extraction agent, Alpha gate, H10/O6.
3. MSA term library still the retired 12-term list with name-only prompting — drives Comp 4, `extract.key_terms`, §8 prompt row, `max_tokens` 2000 vs 3000.
4. No HHH measurement layer (`hhh_scores`, questionnaire, judge, sample sizing, cohorts, HHH launch floors) — drives all L1 %helpful/honest/harmless rows, the 29 codes, the four launch stages, and several observability rows.
5. Five new stories (US-013…US-017) and the summariser/playbook/risk/CRM/reminder/escalation agents are entirely absent.

No files were written or edited during this review.

---

## Counts

Counted from the table above (status column, one row = one requirement; rows marked "(counted under …)" are cross-references and are excluded):

| Status | Rows |
|---|---|
| COVERED | 65 |
| PARTIAL | 49 |
| MISSING | 115 |
| Cross-reference rows (not counted) | 13 |

The reviewer's own verdict line states PARTIAL 50 / MISSING 104. The table is the record; the discrepancy (1 PARTIAL, 11 MISSING) is the reviewer's summary arithmetic, not a change to any row. Of the 115 MISSING rows, 29 are the individual HHH codes H1–A9, 7 are P-1…P-7, and 27 are capability-registry keys.

**Verdict: NEEDS REVISION.**

## MISSING by placeholder class

Each MISSING row is filed under the P-1…P-7 artefact that first satisfies it (Appendix A of the PRD). Where an item needs more than one artefact, the primary one is listed and the others follow in parentheses. Items marked *first build item* are planned capabilities the PRD schedules for the next build rather than a permanent stub; they are still filed under the artefact that carries them until built. A final group holds rows that no placeholder satisfies because they are engineering-doc text only.

### P-1 — Registry entry (`src/lib/capabilities.ts`, `GET /api/capabilities`, `/settings` table)
- P-1
- Flow 2 step 3 (`/settings` "What ContractIQ can do today")
- `import.drive` / `import.dropbox` / `import.sharepoint`
- `redline.word`
- `qa.cross_contract`
- `retrieval.graph`
- `retrieval.query_enhancer` — *first build item* (registry now; enhancer prompt in v0.4)
- Flow 4 step 2 (query-enhancement step) — *first build item*
- `extract.summary` — *first build item* (registry now; column + call under P-3)
- `eval.golden_set_instructor` — *first build item* (registry now; dataset under P-5)

### P-2 — Adapter interface + `NullAdapter` (`src/lib/integrations/<name>/`)
- P-2
- External dep: OCR vendor
- External dep: CRM vendor APIs
- `ingest.docx` (extractor interface; 422 `UNSUPPORTED_FORMAT`)
- `ingest.ocr` (`OcrAdapter`; also `contracts.ocr_confidence` under P-3)
- `crm.hubspot` / `crm.salesforce` (`CrmAdapter`; also `integration_events` under P-3, push route under P-4)
- US-016 (CRM push)
- CRM pusher (agent row)
- Comp 9 (Push to CRM)
- `esign.docusign` (also webhook route under P-4)
- `retrieval.n8n` (external-backend adapter; 501 when unset under P-4)
- `RetrievalStrategy` interface (also `contract_chunks` under P-3)
- `retrieval.vector` (strategy class; also `contract_chunks` under P-3)

### P-3 — Table present, feature-flagged (`database.sql` with RLS and `-- capability:` comment)
- P-3
- `hhh_scores` table + sheet-compatible export
- L1 % helpful, L1 % honest, L1 % harmless (all read from `hhh_scores`)
- HHH questionnaire H1, H2, H3, H4, H5, H6, H7, H8, H9, H10, H11, O1, O2, O3, O4, O5, O6, O7, O8, O9, A1, A2, A3, A4, A5, A6, A7, A8, A9 (one boolean column each in `hhh_scores`)
- `eval.hhh_human` — *first build item* (`hhh_scores` + export)
- Comp 5 (Check terms vs playbook — `playbooks`, `playbook_rules`; also `PlaybookAdmin` under P-6, routes under P-4)
- US-014 (Playbook management)
- `playbook.manage`
- Playbook loader (agent row)
- Comp 6 (Rank risks — `risk_flags`; also route under P-4, `RiskPanel` under P-6, `risk-f1` under P-5)
- US-013 (Risk & compliance flags)
- `risk.flag`
- Risk & Compliance agent (agent row)
- Comp 7 (Decide / escalate — `escalations`; also route under P-4)
- `risk.escalate`
- Escalation router (agent row)
- Harmless rule 4 (escalate after ~3 turns — `escalations`; route under P-4)
- US-017 (Key-date reminders — `key_dates`, `reminders`; cron stub)
- `reminders.key_dates`
- Reminder scheduler (agent row)
- US-015 (Contract summary — `contracts.summary_md`) — *first build item*
- Summariser (agent row) — *first build item*
- Perf: summary ≤10s P95 — *first build item*
- Sampling: `profiles.rollout_cohort` flag
- `rollout.cohorts`
- Observability: Wrong guardrail triggers (`guardrail_events`)
- Observability: Content safety (`guardrail_events` + `hhh_scores` A-codes)
- `observe.guardrail_events`
- Harmless rule 1 (profanity/hate screen logging to `guardrail_events`; rule table in `guardrails.ts`)
- Harmless rule 2 (competitor disparagement — rule table entry + `guardrail_events`)
- Harmless rule 5 (never solicit PII — rule table entry + `guardrail_events`)
- Observability: HHH alert thresholds (`alert_rules`, `alert_events`, nightly job stub)
- `observe.alerts`

### P-4 — Route registered, returns `501 NOT_IMPLEMENTED` with capability key
- P-4 (new `AppError` code `NOT_IMPLEMENTED`)
- (secondary for: US-013 `POST /api/contracts/{id}/risks`; US-016 `POST /api/contracts/{id}/push/{target}`; `risk.escalate` `POST /api/contracts/{id}/escalate`; `esign.docusign` `POST /api/webhooks/esign`; `playbook.manage` routes; `retrieval.n8n` when unset)

### P-5 — Eval runner with a `SKIPPED` row
- P-5
- L2 Risk-detection F1 (`eval/runners/risk-f1.ts` SKIPPED)
- Internal risk: risk flags without ground truth (same runner)
- Observability: Wrong tool calls (SKIPPED row)
- LLM-as-judge (R-26) (`hhh-judge.ts`, `judge-precision.ts` SKIPPED until 50 human rows)
- `eval.hhh_judge`
- `eval.judge_precision`
- Sampling: 20% human-scored, judge scores rest once gated
- Red teaming (R-29) — *first build item* (`eval/redteam/`, `harmless.redteam_pass_rate` row)
- `eval.redteam` — *first build item*
- Foundry JSONL export (R-32) — *first build item*
- `eval.foundry_export` — *first build item*
- Dependency: instructor golden set (`eval/datasets/msa-instructor/`) — *first build item*
- Dataset 3: synthetic corpus (6 NDA + 4 MSA), provenance README
- Internal risk: re-baselining after 36-term library (matcher version in the report schema)
- Failure-seeded few-shot pool `eval/failures/` (R-23)

### P-6 — UI hidden, not absent (component behind `capabilities.<key>.status`, empty state naming the phase; E2E asserts hidden)
- P-6
- Flow 3 step 1 (import / DOCX / scanned shown as disabled options naming their phase)
- Flow 3 step 5 (summary block above terms; `RiskPanel` empty state)
- Flow 3 step 10 (Review mode for the HHH questionnaire)
- (secondary for: `PlaybookAdmin` under US-014; `RiskPanel` under US-013)

### P-7 — Spec per placeholder (`docs/implementation/20-…23-…`)
- P-7
- (every stub above needs a row in the §14 spec mapping: 20 risk & playbook; 21 integrations & capability registry; 22 judge & HHH; 23 observability & alerts)

### Engineering-doc text only — no placeholder artefact satisfies these
- §2 Paralegal persona (add to §3 personas)
- v0.2 MEP (human-review acceptance row in §10)
- Dependency: majority-agreement risk labels (add to §3 personas / §13)
- Model requirements: judge model separate and stronger (§8)
- Model-choice trade table (R-31) (§8)
- Four-reference threshold rationale (§10)
- Sampling: ≥200 scored samples/week per stage; cohorts 1–2% → 2–10% → GA (§10 staged gates)
