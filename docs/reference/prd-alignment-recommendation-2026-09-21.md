# ContractIQ — PRD alignment recommendation

**For:** the student (Excel Fool), AI-Course Tutor session 2026-09-21
**Purpose:** what to change in `docs/ContractIQ_PRD.md` (the repo PRD, v1.0, 24 June 2026 — "our PRD") so that it matches Mahesh's ContractIQ worked example and everything he has taught about his production app, and how the code carries every capability as an **enabled placeholder** even where it is not built yet.
**Source of truth:** Mahesh's worked-example PRD (`ContractIQ_PRD_W3 - Cohort 10.docx` = vault `50-Keystone/reference/contractiq-prd-example.md`). Where his PRD is silent, his lectures, deck, workshop and spreadsheets fill in. Where our PRD is stricter or more specific than his, ours stands and is noted.
**Register:** continues document 02. Next free after this document: **D43, C25, G25**.
**Status:** accepted in full by the student 2026-09-21 (R-21 accepted; C24 resolved as contracts-processed on top).

Labels: `course material [anchor]` = vault-anchored; `timeline [SHEET hhmm]` = the student's own session index; `Mahesh PRD § …` = the worked example by heading; `my view` = the Tutor's recommendation.

---

## 0. Sources reviewed for this recommendation

| Source | Where | What it contributes |
|---|---|---|
| Mahesh's PRD (worked example) | docx / `50-Keystone/reference/contractiq-prd-example.md` | Problem, personas, MOAT, why agentic, North Star + metrics, user flows with hallucination safeguard and explainability, US-001…007, 5-agent capability table with autonomy and HIL triggers, 4-component risk checklist, prioritised stories, roadmap MEP → MVP-1 → GA → Iteration, model requirements, HHH eval link, launch criteria table, data/prompt/responsible-AI/pricing sections (template only) |
| PRD self-eval checklist | `50-Keystone/reference/prd-self-eval-checklist.md` | The grading standard: 9 sections, ~45 yes/no questions |
| Product Roadmap Workshop | docx | Ex.1 nine components; Ex.2 ten-question risk checklist; Ex.3 four tenets + P0–P3; Ex.4 MEP → Phase 4 with named limitations; appendix answers |
| Key-term spreadsheet | `Key_term_name__questions_and_benchmarked_data.xlsx` | 36 MSA key terms × exact question × benchmark answer × benchmark location, 10 contracts; the golden set |
| HHH sample | `HHH_Framework_Evaluation_-_Sample.csv` | The per-row questionnaire: Helpful ×3, Honest ×3, Harmless ×4 |
| MSA webapp eval | `MSA_Webapp_HHH_Key_Term_Extraction_Webapp_-_course.xlsx` | 27 contracts scored on LegalGraph vs OpenAI-vanilla vs DeepSeek; 19 HHH sub-questions; columns value / page / AI reasoning / page / **tool highlight when clicked**; RAG vs no-RAG tab |
| Timeline of sessions | `Timeline_of_Sessions.xlsx` (student's notes) | Session-by-session concept index, SEP4 → SEP20 |
| Vault concept notes (read) | `20-Concepts/` playbook, triple-h, launch-criteria, golden-set-ground-truth, llm-as-judge, minimum-evaluable-product, knowledge-graph, agent-observability, north-star-metric, l1-metric, guardrails, red-teaming, alert-threshold, human-eval, grounding, moat-in-ai, component-risk, agentic-rag, knowledge-base, task-completion-rate | Anchored definitions and instructor framing |
| Vault session notes (read) | `10-Weeks/week-03-agent-kpis-evals/sessions/2026-09-19-sat-live/session-notes.md` + `quotes.md`; `2026-09-16-wed-live/quotes.md` | The live demo of his product and the evaluation method in order |
| Not opened for this document | Week 2 and Week 3 transcripts themselves; Week 3 deck slides | Anchors below that name a transcript timestamp come from the concept and session notes, which cite them; the transcript text was not re-read. Said plainly per TUTOR.md §1 |

---

## 1. The placeholder principle — how "enabled but not built" is expressed in code

You asked for every capability Mahesh describes to exist in the code as a placeholder you can build into later. This is the pattern I recommend so that a placeholder is *real* (typed, tested, observable) without pretending to work. **my view**

**P-1. One capability registry.** `src/lib/capabilities.ts` exports a typed map: `{ key, status: 'built' | 'stub' | 'planned', phase, owner, prd_ref, since }`. Every feature below has a key. `GET /api/capabilities` returns it (authenticated), and `/settings` renders it as a "What ContractIQ can do today" table — Mahesh's Ex.4 "name the limitations" made visible in-product.

**P-2. Adapter interfaces with a `NullAdapter`.** For each external integration (CRM, OCR, e-signature, email, Word redlining, knowledge graph) there is an interface in `src/lib/integrations/<name>/types.ts` and a `null-adapter.ts` that implements it by returning `{ ok: false, reason: 'NOT_CONFIGURED', capability: '<key>' }`. Services call the interface, never the vendor. Wiring a vendor later is one file plus config.

**P-3. Schema present, feature-flagged.** Tables for planned features ship in `supabase/database.sql` now (with RLS), so a later build is code-only, not a migration + backfill. Each table carries a comment `-- capability: <key>, status: stub`.

**P-4. Routes exist and return 501.** Planned API routes are registered and return `501 NOT_IMPLEMENTED` with the capability key in the error envelope (the existing `AppError` taxonomy gets one new code). This makes the API contract reviewable and testable before the feature exists.

**P-5. Evals have a runner and a `SKIPPED` row.** For every metric Mahesh names that we cannot yet measure, `eval/runners/<metric>.ts` exists and emits `status: SKIPPED, reason: ...` into the report schema. Reports then show the full HHH/launch-criteria shape from day one, with honest gaps — the same rule as the testing agent's "unrunnable = FAIL" (D17), applied to evals as "unmeasurable = SKIPPED, never PASS".

**P-6. UI hidden, not absent.** Planned panels exist as components behind `capabilities.<key>.status !== 'planned'`, with an empty state naming the phase. No dead code paths; the E2E suite asserts the hidden state.

**P-7. Spec per placeholder.** Each placeholder gets a short spec under `docs/implementation/` (`20-risk-and-playbook.md`, `21-integrations.md`, …) so the reviewer agents can audit "does the stub match the contract" the same way they audit built features.

---

## 2. Section-by-section changes to our PRD

Numbered **R-n**. Priority: **A** = change the PRD *and* build now (small, high value); **B** = change the PRD now, code as placeholder (P-1…P-7); **C** = change the PRD now, code later, no placeholder needed (docs/policy only). Each row names what Mahesh says, what our PRD says, the change.

### §1 Problem — MOAT, why agentic, differentiation

| # | Mahesh (source) | Our PRD v1.0 | Change | Pri |
|---|---|---|---|---|
| R-1 | MOAT = (1) proprietary corpus of SMB contract types, (2) correction-driven feedback loop, (3) workflow lock-in via renewal tracking + persistent repository — Mahesh PRD § Why is this problem worth solving; lecture: moat = niche vertical, industry-specific evals, feedback loops, "every usage makes you harder to replace" — course material [10-Weeks/week-01-foundations/sessions/2026-09-02-wed-live/transcript-part-1 2:40:32]; "how we manage context is our MOAT" timeline [SEP19SAT 1007]; taste + trust = reasoning + paragraph-level overlay — course material [10-Weeks/week-03-agent-kpis-evals/sessions/2026-09-19-sat-live/transcript-part-2 1:17:09] | Four MOAT pillars: term library, correction loop, confidence, grounded chat. No corpus, no lock-in, no evaluation moat | Rewrite MOAT to Mahesh's three + keep confidence transparency as a fourth. Add one sentence that the **evaluation harness and golden set are themselves the moat** (his 10–15× argument). Add renewal tracking as the lock-in mechanism (R-13) | C |
| R-2 | Differentiation from ChatGPT/Copilot/Claude/Cowork: structured pipeline OCR → extraction → risk flagging → RAG Q&A, defined output schemas, **mandatory clause-level citations for every flag**, persistent repository, renewal tracking — Mahesh PRD § Why Agentic AI | "Why not just ChatGPT" — page reference, confidence, schema, custom terms | Extend to the four-stage pipeline and name risk flagging and the repository; keep our custom-terms point (his PRD lacks it — ours is stronger there) | C |
| R-3 | Unstructured data: PDF, Word, **scanned images (OCR)** — Mahesh PRD § Why Agentic AI | PDF only, text-layer only | Keep text-layer PDF as MVP input; add DOCX and scanned/image as **declared capabilities** with phase | B |

### §2 User — personas

| # | Mahesh | Ours | Change | Pri |
|---|---|---|---|---|
| R-4 | Primary: owner-operator/ops manager, 10–200 employees, 5–15 contracts/month; industries incl. healthcare (BAA), real estate (leases), finance/insurance; **secondary: in-house paralegal / small legal team using it as first-pass triage; outside counsel** — Mahesh PRD § Who | Primary founder/ops lead; secondary freelancer | Keep both of ours; **add the paralegal/legal-team triage persona** — it is the persona that justifies HIL review, playbooks and "human review required for High severity" (R-8, R-11) | C |

### §3 Core metrics, prioritisation, roadmap

| # | Mahesh | Ours | Change | Pri |
|---|---|---|---|---|
| R-5 | North Star = **time-to-clarity** (upload → key terms and risks understood) <30 min, ≥60% reduction — Mahesh PRD § Core Metrics. KPI lesson: North Star = **number of contracts processed**; L1 = task completion %, % helpful, % honest, % harmless, NPS; L1B = cost per contract — course material [10-Weeks/week-03-agent-kpis-evals/01-ai-pm-skills/kpis-for-agents/content › KPIs for Agents], [transcript-youtube-live-lab 0:23:51, 0:37:54]; timeline [SEP16WED PM rows] | North Star = time upload → review complete ≤15 min; primary = F1 ≥88%, calibration, time-to-first-term | **Decided 2026-09-21 (student): North Star = number of contracts processed with review completed (WoW), per the KPI lesson; time-to-clarity ≤ 15 min sits directly beneath it as L1** (ours is stricter than Mahesh's 30 min — keep 15). Restructure the metric tree to Mahesh's KPI form: North Star {contracts processed} → L1 {time-to-clarity, task completion rate per user, % helpful, % honest, % harmless, NPS} → L1B {cost per contract} → L2 {F1, page accuracy, calibration, latency, retention}. The three HHH percentages become first-class metrics the app records (R-16) | A (PRD) + B (code: `hhh_scores` table, R-16) |
| R-6 | Primary metric: clause/**risk** detection accuracy >90% F1 vs CUAD + expert set; entity extraction >90% P/R — Mahesh PRD § Core Metrics | F1 ≥88 NDA / ≥85 MSA, floor 82 | Keep ours for extraction (we have measured 96.9% under matcher v2, 71.9% untuned — document 02 §5b). **Add risk-detection F1** as a metric with target ≥90%, status SKIPPED until R-8 is built | B |
| R-7 | Components (Roadmap Ex.1 appendix): 1 email intake → 2 PDF→text → 3 classify type → 4 extract terms → 5 check vs playbook → 6 rank risks → 7 decide/escalate → 8 summary → 9 CRM push; Mahesh PRD § Prioritisation: a Ingestion & OCR, b Extraction, c Risk & compliance, d Summarisation & Q&A — course material [10-Weeks/week-02-roadmaps-rag/01-ai-pm-skills/product-roadmap-and-prioritization/content › Step 1] | Components A–H: auth, upload/extract, extraction, custom terms, results display, chat, dashboard, feedback | **Replace the component list with Mahesh's nine**, mapping ours onto them (A auth is infrastructure, not a component; D custom terms is part of 4; E/G are UI). Run his ten-question risk checklist on the three we do not have (5 playbook, 6 risk, 9 CRM) — his appendix already rates them High / Medium / Low; copy his ratings and say "adopted from instructor's assessment" | C |
| R-8 | **Risk flags with severity + clause citation + one-sentence "why this matters" = US-002, P0**; risk & compliance agent "suggests, human decides; always HIL for High severity"; ground truth needs 2–3 independent legal reviewers with majority agreement — Mahesh PRD § Functional Requirements, § Agent Capabilities, § Risk Assessment. Playbook = the company's rulebook; terms that break rules are struck out — course material [10-Weeks/week-02-roadmaps-rag/01-ai-pm-skills/product-roadmap-and-prioritization/transcript 0:13:49]; users upload their own playbook, select contract type, one template each — timeline [SEP19SAT 1020]; live demo: upload → playbook → key terms → risks → citation → reasoning → redline in Word — course material [10-Weeks/week-03-agent-kpis-evals/sessions/2026-09-19-sat-live/transcript-part-1 0:10:50] | Absent | **Add US-013 Risk & compliance flags (P0 in the PRD, placeholder in code)** and **US-014 Playbook management (P1)**. Add "Risk & Compliance agent" and "Playbook loader" rows to the capability table with autonomy "suggests, human decides" and HIL trigger "always for High". Code: `playbooks`, `playbook_rules`, `risk_flags` tables; `POST /api/contracts/{id}/risks` → 501; `RiskPanel` hidden; spec `20-risk-and-playbook.md`; eval runner `risk-f1.ts` SKIPPED; **seed a default MSA playbook from Mahesh's PRD examples** (one-sided indemnity, no termination-for-convenience, missing DPA where personal data present, payment terms >60 days) so the first build has rules to check against | B |
| R-9 | Plain-language **summary**, **obligations per party**, compliance notes — Mahesh PRD § User Flows step 3; law firms love the summary capability — timeline [SEP4FREE 1041] | Absent (chat only) | Add **US-015 Contract summary** (P1): one extra GPT-4o call at process time, cached in `contracts.summary_md`, rendered above the terms panel. Cheap; makes time-to-clarity measurable without a chat turn | A |
| R-10 | Comparison agent: redlined contract vs standard template, clause-level diff — US-004 P1 — Mahesh PRD | v1.2 | Keep v1.2 in the roadmap; register capability `compare`, route `501`, no table yet | B |
| R-11 | Roadmap Ex.4 / Mahesh PRD: **MEP** = upload → extract → push (HubSpot/CRM), MSA only; Phase 1 risks vs playbook; Phase 2 redlined Word doc with comments; Phase 3 Q&A across all contracts + learning from feedback; Phase 4 auto-generate playbooks. Mahesh PRD roadmap: MEP weeks 1–8 (US-001/002/003), MVP-1 weeks 9–16 (compare, export, reminders, Drive/Dropbox), GA months 5–6 (BAA flag, DocuSign, teams, billing), Iteration. MEP definition — course material [10-Weeks/week-02-roadmaps-rag/sessions/2026-09-09-wed-live/transcript 2:19:57]: "not MVP, but Minimum evaluable Product" | v0.1 "Foundation (MEP)" = schema + landing + auth + empty dashboard; MEP label misapplied | **Relabel:** v0.1 = Foundation; **v0.2 = MEP** (extraction on real contracts against the golden set, with a human review step). Add a "Deferred vs instructor roadmap" column naming, per phase, which of Mahesh's items we hold as placeholders (CRM push, redlining, playbook auto-generation, cross-contract Q&A). Keep our v1.0–v1.2 items; they are a superset of his MVP-1/GA on export, batch, OCR, comparison, teams | C |
| R-12 | P0 in Mahesh's prioritisation: extract terms; citation; **edit value/citation/reasoning**; **push key terms to CRM automatically** ("what makes the workflow valuable and billable, fast") — Roadmap Workshop A3 | Edit value only (US-009); no CRM | (a) Extend US-009: the user can edit **value, page citation, and the "why" reasoning**, each preserved with its original (`original_ai_page`, `original_ai_reasoning`). (b) Add **US-016 CRM push** (P1 in PRD, placeholder in code): interface `CrmAdapter { pushKeyTerms(contractId) }`, `NullAdapter`, `POST /api/contracts/{id}/push/{target}` → 501, `integration_events` table, capability `crm.hubspot`, `crm.salesforce` | A (edit) + B (CRM) |
| R-13 | Renewal/deadline reminders 30/60/90 days, email + in-app — US-006 P1; the lock-in half of the MOAT — Mahesh PRD | v1.2 email notification only | Add **US-017 Key-date reminders** (P1): `key_dates` derived from extracted terms (End Date, Notice to not auto-renew, Renewal Period); `reminders` table; scheduler stub via the existing `pg_cron` + `send-notification` Edge Function (written, undeployed — document 02 §6); capability `reminders` | B |
| R-14 | DocuSign / Adobe Sign integration; signed contract auto-triggers extraction — Mahesh PRD GA; Roadmap A3 P2 | Absent | Capability `esign.docusign` with `NullAdapter`; webhook route `POST /api/webhooks/esign` → 501 | B |
| R-15 | HIPAA BAA flag when PHI language present without a BAA — US-007 P2 | Absent | Fold into R-8 as a **playbook rule** (`rule_type: 'absence'`), not a separate feature | B (inside R-8) |

### §4 MVP features — flows and capability table

| # | Mahesh | Ours | Change | Pri |
|---|---|---|---|---|
| R-16 | Every flag and answer shown with underlying clause, **confidence High/Medium/Low**, and a **"why did the AI say this" trace**; product decision: answer + citation + reasoning — Mahesh PRD § User Flows step 6; timeline [SEP20SUN 1013, 1016]; MSA webapp columns: value / page / AI reasoning / page / tool highlight | We have value + page + source sentence ("Why?") + confidence % | **Rename and widen "Why?" to `reasoning`:** the model returns `{value, page_number, source_sentence, reasoning, confidence}`; reasoning is a one-sentence explanation, not only the quote. Persist `reasoning`, make it editable (R-12a). Record the **HHH questionnaire answers** per term when a human reviews (R-21) in `hhh_scores` | A |
| R-17 | Agent capability table with **autonomy level** and **HIL trigger** per agent: Ingestion & OCR (autonomous; <80% OCR confidence ⇒ re-upload), Extraction (autonomous + review; required field missing ⇒ flag), Risk & compliance (suggests, human decides; always for High), Summarisation & Q&A (autonomous; user can ask for source clause), Comparison (autonomous; new High-risk clause ⇒ review) — Mahesh PRD § Agent Capabilities | Five rows: PDF extractor, term extractor, confidence evaluator, chat agent, feedback logger | Rebuild the table on Mahesh's five agents + ours: keep Confidence Evaluator and Feedback Logger; add Risk & Compliance, Summariser, Comparison, Playbook Loader, CRM Pusher, Reminder Scheduler, each with autonomy and HIL trigger and a `status` column (built / stub / planned) that mirrors the capability registry | A (PRD) |
| R-18 | Hallucination safeguard: **"not found in this contract" instead of guessing**; any flag above severity threshold labelled "High risk — recommend human/legal review"; persistent "Not legal advice" — Mahesh PRD § User Flows step 5 | Have: "I cannot find this in the document"; disclaimer; confidence <50 warning | Match — no change except adding the High-severity label once R-8 exists | — |
| R-19 | Upload via drag-drop **or Google Drive / Dropbox import**; formats PDF/DOC/DOCX/scanned — Mahesh PRD US-001; SharePoint sync — timeline (Contracts §, student's lecture notes) | PDF drag-drop only | Capability `import.drive`, `import.dropbox`, `import.sharepoint` with `NullAdapter`; DOCX ingestion as `stub` (a `mammoth`-based extractor is a small build — recommend **A** once R-8 lands) | B |

### §5 Constraints — sampling and rollout

| # | Mahesh | Ours | Change | Pri |
|---|---|---|---|---|
| R-20 | Launch to 1–2% of users first, sized so ≥200 samples arrive per week; a bigger first cohort loses trust permanently — course material [10-Weeks/week-03-agent-kpis-evals/sessions/2026-09-19-sat-live/transcript-part-1 0:55:37, 0:56:47]; [2026-09-20-sun-lab/transcript 1:10:59] | Measurement Beta ≤50 users | Add the **200-samples-per-week rule** as the sizing constraint for each launch stage, and a `rollout_cohort` flag on `profiles` (placeholder) so a cohort can be selected without a deploy | B |

### §7–§8 Grounding and prompt strategy

| # | Mahesh | Ours | Change | Pri |
|---|---|---|---|---|
| R-21 | Golden set per key term: **question, benchmark answer, benchmark location** — course material [10-Weeks/week-03-agent-kpis-evals/01-ai-pm-skills/evaluating-gen-ai-applications-part-2-agents/content › Appendix]; "They gave me 40 terms and then I put the ground truth" [how-to-set-metrics… transcript-youtube-live-lab 0:25:31]; the 36-term MSA set with answer-format constraints (months, days, hours, Yes/No/N/A, Net 30) — key-term spreadsheet | Term library: 10 NDA / 12 MSA names, no question text, no answer format; eval corpus synthetic (6 NDA, 4 MSA) — document 02 §5b | **(a) Replace the MSA term library with Mahesh's 36 terms**, each carrying `question`, `answer_format`, `display_rank`; keep our 12 as a "core" subset via `display_rank ≤ 12`. **(b) Make the 10-contract spreadsheet the primary MSA golden set** in `eval/datasets/msa-instructor/`, keeping the synthetic corpus as a secondary set. **(c) The extraction prompt asks each term's *question*, not just its name** — this is what makes answers comparable to the benchmark and is his stated method ("if a human will do it, how will they do it?") | A |
| R-22 | Agentic RAG: classify query → enhance → retrieve → answer with citations; greeting never touches the store — course material [10-Weeks/week-02-roadmaps-rag/03-hands-on-lab/lab-2.3-lab-2-3-agentic-rag/README › 3. Core Concept]; his demo backend: webhook → chunk/embed → vector store → classifier normal/sophisticated → query-enhancer → RAG agent — timeline [SEP20SUN 1002–1013]; knowledge graph for multi-hop, 30–50% context reduction — course material [10-Weeks/week-02-roadmaps-rag/sessions/2026-09-12-sat-live/transcript 1:11:25], timeline [SEP4FREE 1044–1053]; RAG vs no-RAG measured on Ericsson — MSA webapp tab | Full-context, no chunking, no vector store, classifier contract/history/both, no query enhancement; KG absent | Keep full-context as the **built** retrieval mode (correct at ≤20 pages; document it as a deliberate scoping choice with Mahesh's cost argument — timeline [SEP9WED 1029–1033]). **Add a `RetrievalStrategy` interface** with three implementations: `full-context` (built), `vector-rag` (stub — chunk/embed/retrieve, table `contract_chunks` with `vector` column present but unused), `graph-rag` (planned). Add a **query-enhancement step** to the chat pipeline (built — one small prompt, gated by the classifier so greetings skip it). Capability keys `retrieval.vector`, `retrieval.graph`, `retrieval.query_enhancer`. This is also where your 16SEPT Agentic RAG n8n workflow (`4LGHo4nIjRn8a40a`) can be registered as an **external backend adapter** (`retrieval.n8n`) — an honest placeholder for Mahesh's architecture without lift-and-shift | B (vector/graph) + A (query enhancer) |
| R-23 | Prompt strategy: few-shot, CoT, conditional; per-task output formats; improve from error analysis; **use failures as seeds for synthetic data** — checklist §7; timeline [SEP20SUN 1202]; "start giving examples in the system prompt" [SEP20SUN 1107] | Few-shot 3+3, JSON, repair prompt; A/B monthly | Add a **failure-seeded example pool**: `eval/failures/` → curated into the few-shot block by prompt version; document the loop | C |

### §9 Hallucination guardrails → §11 HHH, launch criteria, observability

| # | Mahesh | Ours | Change | Pri |
|---|---|---|---|---|
| R-24 | **HHH questionnaire** per response: Helpful — not solving the specific problem? too verbose? misses key info?; Honest — fabricated? cited source incorrect/unverifiable? cited quote non-existent?; Harmless — harmful content? solicits PII? reveals internal info / encourages harm? shares company demerits? — HHH CSV; MSA webapp's 19 sub-questions incl. "was the page number correct", "were related provisions highlighted when clicked", "extracted from the correct contract of a stitched document", "does the tool avoid answering generic/non-contract questions" — course material [10-Weeks/week-03-agent-kpis-evals/01-ai-pm-skills/evaluating-gen-ai-applications-part-2-agents/content › Step 4]; any "Yes" marks the response unsuccessful — [[human-eval]] | HHH as a 3-row strengths/risks table; no per-response questionnaire | **Adopt the questionnaire as the eval schema.** `hhh_scores` table (contract_id, term_id or message_id, evaluator = 'human' | 'llm-judge', the 10–19 yes/no columns, verdict); export matches Mahesh's sheet column-for-column so his sheet can be filled from our data (timeline [SEP20SUN 1016–1018]: config.json → question, response, citation, reasoning → two human columns). Add a **"Review" mode** to the results page (P-6 placeholder) where an SME answers the questions per term | A (schema + export) + B (UI) |
| R-25 | Launch criteria as HHH thresholds per phase: **Measurement 1–2% users: helpful 60 / honest 75 / harmful <5; Beta 2–10%: 70 / 85 / <3; Launch: 80 / 90 / <2** — course material [10-Weeks/week-03-agent-kpis-evals/01-ai-pm-skills/evaluating-gen-ai-applications-part-2-agents/content › Step 5], [how-to-set-metrics… 0:28:27]; threshold set from model ceiling, customer floor, competitor score, company policy ("we don't release beyond 70%") — [2026-09-19-sat-live/transcript-part-1 0:51:57] | Alpha / Measurement Beta / Public Launch with F1, correction rate, satisfaction; HHH named but not scored | **Add the three HHH percentages to every launch-stage row** with Mahesh's numbers as the floor (ours can be stricter). Add the four-reference method as the rationale line. Keep F1 / correction rate / calibration as L2 gates | A (PRD) |
| R-26 | LLM-as-judge: a validator agent scores against the HHH questions; **the judge itself is measured with precision/recall on a golden set and must stay >70% before it replaces the human**; judge kept out of the product prompt, may run on a stronger model — course material [[llm-as-judge]]; [2026-09-16-wed-live 2:04:31]; [2026-09-19-sat-live/transcript-part-1 1:13:48, part-2 0:29:39, 0:58:49]; Lab 3.2: judge ≠ agent; GPT-4o judge 64% vs GPT-5 judge 86% on the same answers | Eval suite is deterministic matching (F1, page accuracy, calibration); no LLM judge | Add **spec 22 — Judge**: `eval/runners/hhh-judge.ts` that answers the questionnaire per row with a separate model, and `eval/runners/judge-precision.ts` that scores the judge against human `hhh_scores` rows. Gate: judge P/R ≥ 0.70 before its verdicts count toward launch criteria. Placeholder until ≥ 50 human rows exist | B |
| R-27 | Human eval never goes away: ~⅓–⅖ stays human; "Always get the human data" — [2026-09-16-wed-live 2:58:30]; [2026-09-19-sat-live/transcript-part-2 0:55:01] | Monthly SME audit of 5 contracts | Write the ratio into §10: 20% of weekly samples human-scored, judge scores the rest, drift check compares them | C |
| R-28 | Guardrails = criteria for what is permissible: no profanity/hate, no competitor disparagement, **stay within the contract**, escalate to a human after ~3 turns, never solicit PII — course material [[guardrails]]; a guardrail alone leaves a useless refusing agent [rag-and-agentic-rag/transcript-rag 0:04:15] | Prompt-injection screen, document-only prompt, disclaimer | Add a **Harmless policy** section listing the five rules; code: `src/lib/security/guardrails.ts` with a rule table (built for injection + off-scope; `stub` for PII solicitation, competitor mention, escalate-after-N-turns with `escalations` table and `POST /api/contracts/{id}/escalate` → 501) | A (policy) + B (escalation) |
| R-29 | Red teaming: attack suite pointed at the agent endpoint; a release gate — course material [[red-teaming]] | Prompt-injection unit tests | `eval/redteam/` with a seed attack set (injection, off-scope, PII solicitation, competitor bait, profanity) run every deploy; report row `harmless.redteam_pass_rate` | A (small) |
| R-30 | Observability > evals: cost per session/user/task, time per task, error rate per component, wrong guardrail triggers, wrong tool calls, task adherence, intent resolution, content safety; alerts when a rate crosses a threshold ("helpful <70%", "harmless >2%") — course material [[agent-observability]] [2026-09-16-wed-live/slides slide 36], [[alert-threshold]] | `processing_runs`, `openai_calls`, `activity_events`, 80% budget alert, correction-rate alert | Add an **Observability** subsection mapping each of Mahesh's measures to a table/column we have or add: cost per session (`openai_calls` ✓), per task ✓, error rate per component (add `component` to `processing_runs.stage` ✓ partly), guardrail triggers (`guardrail_events` new), wrong tool calls (n/a until tools exist — SKIPPED), HHH alerts (`alert_rules` table + nightly job stub). PM sets thresholds; engineering wires traces — quote his role split | B |
| R-31 | Accuracy vs latency vs cost triangle; defend a model choice with the measured trade; Haiku drops accuracy ~10% but cuts latency — [2026-09-19-sat-live/transcript-part-2 0:58:49]; timeline [SEP19SAT 1251] | Model requirements table; GPT-4o only | Add a **model-choice trade table** with three rows (GPT-4o, a cheaper model, a stronger judge model) and the columns accuracy / latency / cost / where used. Provider-neutral `LlmProvider` already exists (engineering doc §8.5) — register `model.extraction`, `model.chat`, `model.judge` as separately configurable | A (PRD) |

### §10 Evaluation strategy — datasets

| # | Mahesh | Ours | Change | Pri |
|---|---|---|---|---|
| R-32 | Ground truth from **real contracts** (public filings, EDGAR, synthetic to fill gaps); 150–200 expert-labelled SMB contracts before MVP sign-off; 2–3 reviewers for risk labels — Mahesh PRD § Risk Assessment; Roadmap A2 | CUAD + 30 NDA + 20 MSA "before beta"; today synthetic 6+4 | Restate the dataset plan as: (1) the instructor's 10-contract MSA set (now), (2) CUAD subset (now), (3) synthetic (now, secondary), (4) SME-labelled 30+20 (before beta), (5) risk labels with majority agreement (before R-8 ships). Put the **Sunday-lab export format** (question, response, citation, reasoning → JSONL for Foundry) into §10 so evals can also run in Foundry — timeline [SEP20SUN 1045–1053] | A (docs) + B (JSONL exporter, small) |

### §11 Responsible AI, §12 Pricing — template completeness

| # | Mahesh | Ours | Change | Pri |
|---|---|---|---|---|
| R-33 | Checklist §8: HIL and fallback paths, sensitive use cases, safe failure modes | Have accountability/transparency/fairness/reliability tables | Add HIL paths per agent (from R-17) and the escalation route (R-28) | C |
| R-34 | Checklist §9 and Mahesh's PRD § Pricing: cost/accuracy trade-offs table (framework, LLM, libraries, UI, vector DB, hosting, editor), dev costs, ops costs, TAM/SAM, revenue, pricing model, directional pricing; his pitch: ~30% accuracy over vanilla + ~10% from KG ⇒ ~10× price — timeline (student's lecture notes) | All present; billing unbuilt (A-06) | Fill the **cost/accuracy trade-off table** in his seven-row shape (we have the data from the build: pdf-parse, GPT-4o, Netlify Pro, Antigravity). Add the measured **vanilla vs ContractIQ** comparison as the pricing anchor once the judge (R-26) can score both — until then cite his 0.81/0.74 vs 0.78/0.48 numbers as the instructor's benchmark, not ours | C |

### Things in our PRD that are stronger than Mahesh's — keep, and say so

- Full functional-requirements table FR-01…FR-14, single paste-and-run SQL with Storage RLS (FR-14), text-viewer fallback (FR-06), custom terms (US-005), confidence calibration metric, 200-message chat memory with classifier, cost ceiling $0.25, incident-communication plan, 14 model/data assumptions. None of these is in his worked example. **my view:** they are the engineering half he leaves to the reader; keep every one.

---

## 3. The capability registry — full placeholder inventory

The list the code will carry (P-1). `built` = exists today; `stub` = interface + null adapter + table/route/eval row; `planned` = registry entry only.

| Key | Mahesh source | Status now | Phase | Stub artefacts |
|---|---|---|---|---|
| `ingest.pdf_text` | PRD a; Roadmap 2 | built | — | — |
| `ingest.docx` | PRD § Why Agentic AI | stub | v1.1 | extractor interface, 422 `UNSUPPORTED_FORMAT` today |
| `ingest.ocr` | PRD US-001, <80% ⇒ re-upload | stub | v1.2 | `OcrAdapter`, `NullAdapter`, `contracts.ocr_confidence` |
| `import.drive` / `import.dropbox` / `import.sharepoint` | PRD US-001; lectures | planned | v1.1 | registry only |
| `classify.contract_type` | Roadmap 3 | built (detected_type) | — | — |
| `extract.key_terms` | PRD b; Roadmap 4 | built | — | R-21 replaces the MSA library |
| `extract.summary` | PRD step 3 | **build now (R-9)** | v0.3 | — |
| `playbook.manage` | Roadmap 5; SEP19SAT 1020 | stub | Phase 1 | tables, `PlaybookAdmin` hidden, seed rules |
| `risk.flag` | PRD c, US-002 P0; Roadmap 6 | stub | Phase 1 | `risk_flags`, route 501, `RiskPanel` hidden, `risk-f1.ts` SKIPPED |
| `risk.escalate` | PRD HIL "always for High"; guardrails | stub | Phase 1 | `escalations`, route 501 |
| `redline.word` | Roadmap Phase 2; demo | planned | Phase 2 | registry only |
| `qa.single_contract` | PRD d | built | — | — |
| `qa.cross_contract` | Roadmap Phase 3 | planned | Phase 3 | registry only |
| `retrieval.full_context` | our PRD §7 | built | — | — |
| `retrieval.query_enhancer` | Lab 2.3; demo | **build now (R-22)** | v0.4 | — |
| `retrieval.vector` | Lab 2.2/2.3; demo | stub | v2 | `contract_chunks` table, strategy class |
| `retrieval.graph` | Lab 2.4; KG lectures | planned | v2 | registry only |
| `retrieval.n8n` | 16SEPT Agentic RAG workflow | stub | — | external-backend adapter, config URL, 501 when unset |
| `compare.contracts` | PRD US-004 | stub | v1.2 | route 501 |
| `export.csv_pdf` | PRD US-005 | built (v1.1 spec) | — | — |
| `reminders.key_dates` | PRD US-006 | stub | v1.1 | `key_dates`, `reminders`, cron stub |
| `crm.hubspot` / `crm.salesforce` | Roadmap 9, P0 | stub | Phase 1 | `CrmAdapter`, `integration_events`, route 501 |
| `esign.docusign` | PRD GA | stub | GA | webhook route 501 |
| `eval.golden_set_instructor` | key-term spreadsheet | **build now (R-21b)** | — | — |
| `eval.hhh_human` | HHH CSV; webapp sheet | **build now (R-24)** | — | `hhh_scores`, export |
| `eval.hhh_judge` | LLM-as-judge lectures | stub | after 50 human rows | runner SKIPPED |
| `eval.judge_precision` | same | stub | same | runner SKIPPED |
| `eval.redteam` | red-teaming lectures | **build now (R-29)** | — | — |
| `eval.foundry_export` | Sunday lab | **build now (R-32)** | — | JSONL exporter |
| `observe.guardrail_events` | slide 36 | stub | v1.0 | table |
| `observe.alerts` | alert-threshold | stub | v1.0 | `alert_rules`, nightly job stub |
| `rollout.cohorts` | 200-samples rule | stub | v1.0 | `profiles.rollout_cohort` |
| `billing` | our PRD §12 (A-06) | planned | GA | registry only |

---

## 4. What this does to the engineering doc and specs

The reviewer agents were built to audit against one PRD. After the PRD edit:

1. `docs/ContractIQ_PRD.md` → v1.1 with the R-changes; `docs/reference/ContractIQ_PRD-instructor.md` filed beside it (D41: instructor PRD registered as a second input).
2. `engineering-reviewer` runs in **delta mode** against v1.1 and produces `docs/engineering/delta-v1.1.md` — a NEEDS REVISION list, not a rewrite (I1-d from Stage 1).
3. `implementation-spec-planner` writes specs 20–23 (risk & playbook; integrations & capability registry; judge & HHH; observability & alerts) for the stubs, and amends 03/04 (term library + question-based extraction), 08 (query enhancer), 17 (golden set, HHH schema, redteam, Foundry export).
4. `CLAUDE.md` gains **Stage 9 — Evaluation** and the C23 fix.
5. Each later stage of our walk-through then checks the code against v1.1, not v1.0.

---

## 5. Register additions from this document

| # | Entry |
|---|---|
| **D42** | R-1…R-34 accepted in full; R-21 (36-term MSA library replaces the 12-term library) accepted with its re-baselining consequence; C24 resolved as contracts-processed North Star (student, 2026-09-21) |
| **D41** | Mahesh's worked-example PRD is registered as the source of truth; the repo PRD is graded against it and revised to v1.1 (student's instruction 2026-09-21) |
| **C24** | Two North Star definitions in the instructor's material: time-to-clarity (worked-example PRD) vs number of contracts processed (KPIs for Agents lesson, [transcript-youtube-live-lab 0:23:51]). Resolved by the student 2026-09-21: contracts processed is the North Star; time-to-clarity is the first L1 metric beneath it (R-5) |
| (carried) | C22 — repo PRD narrower than instructor PRD, evidenced in Stage 1; C23 — `CLAUDE.md` Stage 1 two-document claim; G24 — engineering agents' memory gone from disk |

---

## 6. Decision needed from you

Accept the set as recommended, or name exceptions. Default if you say "accept": all **A** items are built in this walk-through; all **B** items become placeholders per §1; all **C** items are PRD text only. The one place I want a specific answer: **R-21 replaces the MSA term library with Mahesh's 36 terms.** That changes extraction output for MSAs on the live site and re-baselines your F1 numbers — the right thing for alignment, but it is a visible change, so it is yours to name.
