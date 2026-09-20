---
name: contractiq-spec-review-history
description: Round-by-round verdicts and recurring issue patterns from reviewing docs/implementation/ against the ContractIQ PRD and engineering doc
metadata:
  type: project
---

Review log for the ContractIQ implementation specs (`/Users/teodorsimeonov/dev-os/docs/implementation/`, 22 files) audited against `docs/ContractIQ_PRD.md` and `docs/engineering/engineering-doc.md`.

**Why:** the planner (`implementation-spec-planner`) iterates on my findings; tracking which requirements fail repeatedly shows where the spec set is structurally weak, not just locally wrong.

**How to apply:** at the start of each new round, re-audit from scratch, then check this log for recurring classes before writing up — a third repeat is worth calling out as a pattern rather than a line item.

| Round | Date | Verdict | Issues |
|---|---|---|---|
| 1 | — | NEEDS REVISION | 13 |
| 2 | — | NEEDS REVISION | 8 |
| 3 | — | NEEDS REVISION | 5 |
| 4 | 2026-09-20 | NEEDS REVISION | 3 |
| 5 | 2026-09-20 | NEEDS REVISION | 2 |
| 6 | 2026-09-20 | NEEDS REVISION | 1 |
| 7 | 2026-09-20 | NEEDS REVISION | 1 |
| 8 | 2026-09-20 | **APPROVED** | 0 |

**Round 4 issues:** (1) spec 12 §15 contradicted spec 11 §3 on account deletion; (2) `NEXT_PUBLIC_STATUS_PAGE_URL` missing from `publicConfig`; (3) spec 13 §5 cited the wrong SQL section for `on_plan_change_reset_quota`. All verified fixed.

**Round 5 issues:** (1) `/auth/callback` route path contradiction between spec 00 §5 / eng-doc §11 and spec 03 / eng-doc §5.2; (2) garbled `supabase-schema.sql` §17 comment. Both verified fixed.

**Round 6 issue:** spec 00 §2 and 11 §2 asserted Edge Functions were used *only* for the 90-day purge, contradicting 14 §2a's `send-notification`.

**Round 7 issue:** the *same* over-narrow A-02 restatement surviving in a fourth file — 19 §F. Verified fixed in round 8: 19 §F row 2 and §J now state A-02 in its settled form and cite 00 §2, 11 §2, 12 intro, 14 §2a.

**Round 8 (APPROVED):** independent re-extraction from both sources found zero gaps. Also verified the planner's self-reported extra fix: 19 §P item 4 now matches 06 §3 step 2 (`409 ALREADY_PROCESSED` refuses re-processing a completed contract). Swept every "only/never/always" claim in 00, 01, 12, 19 against its owning feature spec — all agree. Deliberately did **not** flag: the out-of-order `2b)`/`2)` verification comments in `supabase-schema.sql` and the 3-cell rows in 19 §I's 2-column table (cosmetic, not source requirements); the 24 s `/process` deadline that can skip some of the PRD's 3 retries (disclosed in 06 §3a and 19 §P item 5).

**Recurring pattern (rounds 4–7, now closed):** failures were almost never missing features — they were *cross-reference drift*, where a decision corrected in its owning spec left superseded wording in the summary/reference specs (00 overview, 01 config, 12 api-reference, 19 traceability). Round 7 was round 6's issue surviving in a fourth file because the fix had been verified by grepping one exact phrasing. **Method that finally worked and should be reused:** re-derive each claim's *meaning* and check every summary spec for any wording of it; treat every "only/always/never" sentence in a summary spec as a claim to verify against the owning spec.

**Standing context:** settled decisions A-01, A-02, A-05, A-06, A-07, A-16 and "OpenAI GPT-4o sole provider" are user-approved and must never be raised as findings. Known eng-doc internal inconsistencies are recorded in 19 §J2 (account deletion §9.15 vs §7.1; advisory-lock semaphore; PostgREST transaction; `/auth/callback` §5.2 vs §11) and A-03 (chat history last-10 vs full-200).
