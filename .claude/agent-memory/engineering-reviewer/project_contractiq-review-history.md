---
name: contractiq-review-history
description: Review-round history for docs/engineering/engineering-doc.md against ContractIQ_PRD.md — verdicts, issues raised, recurring patterns
metadata:
  type: project
---

Review log for the ContractIQ engineering doc (reviewer gate, PRD v1.0 dated 2026-06-24).

**Why:** the planner/reviewer loop repeats until APPROVED; knowing which requirement classes failed before makes later rounds faster and flags patterns.

**How to apply:** on any new round, re-derive requirements from the PRD from scratch, but pay extra attention to the areas listed below — they are where this doc has historically been thin.

## Rounds

- **2026-09-20 — Round 1: NEEDS REVISION (4 issues)**
  1. PRD §3 External Dependencies "Test against 50 real-world NDAs and MSAs during beta" (PDF.js rendering compatibility) — named but not technically addressed in §13.
  2. PRD §11 Launch Criteria staged gates (Internal Alpha / Measurement Beta / Public Launch) — missing as an engineering-owned, measurable structure.
  3. §1 success-criteria latency row did not match the measurement definition used in §7.8/§16 (inconsistent).
  4. §9.16 export plan gating conflicted with PRD §12 "Free Trial — full features".

- **2026-09-20 — Round 2: APPROVED (0 issues)**
  All four fixed: new §13 "PDF rendering compatibility" test layer (50-contract real-world corpus, ≥95% clean render, 100% of remainder must hit text-viewer + Download PDF fallback, run during beta and on every pdfjs-dist upgrade) wired into US-006 acceptance and the beta gate; new §10 "Staged launch gates" table with a measurement source per criterion, including a two-part measurement path for "0 incidents of misleading output without a confidence warning"; §1 latency row now `processing_runs.duration_ms` P95 `WHERE stage='total'` matching §7.8/§16; §9.16 export available on Free Trial/Growth/Pro, withheld only from Starter post-trial, recorded as Appendix A entry A-16.

## Patterns observed

- Recurring weak class (round 1): **PRD statements that are qualitative promises rather than features** — "test against 50 contracts", "0 incidents of X", launch-criteria tables. The planner tends to name them without a measurement source. Check these first in any future round.
- Strong class: functional requirements (FR-01…FR-14), user stories, DB/API coverage, and NFR traceability (Appendix B) have passed cleanly in every round.
- Appendix A ("Resolved PRD Ambiguities") is the planner's mechanism for PRD conflicts; judge each new A-NN entry on whether it honours *both* sides of the conflicting PRD text. A-16 passed on that test.
