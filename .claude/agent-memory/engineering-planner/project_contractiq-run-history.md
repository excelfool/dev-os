---
name: contractiq-run-history
description: Run history for the ContractIQ engineering doc — dates, self-review cycles, reviewer verdicts, and the one class of requirement that keeps slipping
metadata:
  type: project
---

## 2026-09-20 — initial generation
`docs/engineering/engineering-doc.md` written from `docs/ContractIQ_PRD.md`. 2 self-review cycles; reviewer verdicts NEEDS REVISION → APPROVED (2 rounds).

Round 1 findings, all valid: (1) PRD §3's "test PDF.js against 50 real-world NDAs/MSAs during beta" missing — I had the Download-PDF fallback but not the corpus test; (2) PRD §11's three-stage Launch Criteria table only operationalised for Public Launch, and "0 incidents of misleading output without a confidence warning" had no measurement path; (3) `processing_runs.total_ms` cited in §1 but the schema defines `stage` + `duration_ms` — an internal contradiction; (4) export gated Growth+ while PRD §12 promises Free Trial "full features".

**Why it matters:** the failing class was consistent across my own self-review *and* round 1 — **PRD qualitative promises rather than features**: corpus-based tests, "0 incidents of X" style criteria, and staged launch-criteria tables. These get named in the doc but not given a measurement source. Functional requirements, DB/API coverage and NFR traceability passed cleanly both rounds.

**How to apply:** on any future ContractIQ doc revision or similar PRD, sweep the PRD for (a) test corpora with a stated size, (b) "0 incidents / 0 failures" criteria, (c) staged go/no-go tables, and (d) any number quoted in one section but keyed to a column defined in another — and pair each with an explicit measurement source before self-review. Also cross-check every metric in the summary section against the actual schema column names.

See [[contractiq-architecture-decisions]].
