---
name: contractiq-architecture-decisions
description: Architectural decisions taken in the ContractIQ engineering doc that resolve PRD ambiguities — frontend, backend, chat history, billing, Realtime, export gating
metadata:
  type: project
---

The ContractIQ engineering doc (`docs/engineering/engineering-doc.md`) resolves these PRD ambiguities. All are recorded in its Appendix A; ⚠ ones still need product confirmation.

- **Frontend ⚠:** Next.js 14 App Router, not the PRD's "React SPA". Project convention fixes Next.js; all PRD requirements still hold.
- **Backend ⚠:** Next.js Route Handlers (Node runtime) on Netlify for request/response APIs; Supabase Edge Functions only for the scheduled 90-day PDF purge. PRD §6 offered either.
- **Chat history:** full history up to 200 messages ascending (§7 + Assumption 14) wins over §8's "last 10 turns".
- **Email verification ⚠:** both paths built; MVP default is confirmation OFF (matches Flow 1's narrative and the ≤10s auth target).
- **Billing ⚠:** PRD defines four paid tiers but no payment provider, checkout or billing story anywhere. MVP ships plan state + quota enforcement only, no payment collection.
- **Realtime:** listed in PRD §6 for "chat message streaming" but unused — chat is request/response, which is what the ≤15s P95 measures.
- **Export gating ⚠:** PRD conflicts (Growth tier lists export; Free Trial promises "full features"). Resolved as available on Free Trial/Growth/Pro, withheld only from Starter post-trial.

**Why:** these were genuine PRD contradictions or omissions, not preferences; each was resolved toward the more specific / more frequently stated PRD text rather than silently picked.

**How to apply:** if any of these is later confirmed differently by the user, Appendix A names the alternative and its cost — start there. Do not re-litigate the non-⚠ ones without new PRD text.

See [[contractiq-run-history]].
