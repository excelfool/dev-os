# Project Guide

This project uses a structured, step-by-step workflow to go from a product idea to a fully built app. Five skills drive the process. Follow the stages in order and **never move to the next stage without explicit user approval**.

---

## Core Rule: Always Wait for Approval

After completing any stage, stop. Present what was produced. Ask the user if they are happy to proceed to the next stage. Do not move forward until they say yes.

---

## The Build Workflow

### Stage 1 — Engineering Plan
**Skill:** `/engineering-planner`
**Input:** A PRD or product description from the user
**Output:** `docs/engineering/engineering-doc.md`

Transform the user's requirements into one document:
- `engineering-doc.md` — high-level architecture (stack, flows, DB design, API spec, folder structure)

Per-feature implementation specs are **not** produced here; they are generated at Stage 2 under `docs/implementation/`.

Before generating, use `AskUserQuestion` to resolve any missing architectural decisions (auth strategy, database, LLM provider, user roles, etc.).

When done, show the user what was created and ask:
> "The engineering document is ready in `docs/engineering/`. Review it and let me know when you're happy to move to Stage 2."

---

### Stage 2 — Implementation Specs
**Skill:** `/implementation-specs`
**Input:** `docs/engineering/engineering-doc.md` (from Stage 1)
**Output:** `docs/implementation/` — detailed spec files + `docs/implementation/supabase-schema.sql` + `.env.example`

Read the approved engineering plan and generate granular, runnable implementation specs. The LLM decides what spec files are needed based on the plan. Always includes:
- `docs/implementation/supabase-schema.sql` — paste-and-run SQL for Supabase SQL Editor (tables, RLS policies, indexes, triggers)
- `.env.example` — every environment variable the app needs, grouped by service

When done, show the user what was created and ask:
> "All implementation specs are in `docs/implementation/`. The Supabase schema SQL is ready to run. Review the specs and let me know when you're ready for Stage 3."

---

### Stage 3 — Frontend Setup
**Skill:** `/frontend-setup`
**Input:** Approved specs from Stage 2
**Output:** Scaffolded Next.js 14 (App Router) project with full folder structure

Scaffold the Next.js project based on the folder structure and conventions defined in the specs. Ask the user where to create the project folder before writing any files.

When done:
> "Your Next.js app is scaffolded and running. Folder structure is in place. Let me know when you're ready to move to Stage 4 — Feature Implementation."

---

### Stage 4 — Feature Implementation
**Input:** Spec files from `docs/implementation/`
**Process:** Build one feature at a time

For each feature:
1. Read the relevant spec file(s) from `docs/implementation/`
2. Tell the user which feature you are about to implement and what files will be created or changed
3. Wait for their confirmation before writing any code
4. Implement the feature
5. Confirm it is done and ask which feature to build next

> **Always apply `/design-system` when writing any frontend code.** All colors, spacing, typography, and component styles must come from the design system defined in `docs/design.md`.

When all features are implemented, ask:
> "All features are implemented. Ready to move to Stage 5 — Testing?"

---

### Stage 5 — Testing
**Input:** Implemented features from Stage 4
**Output:** Test suite covering unit, integration, and E2E flows

For each implemented feature:
1. Write unit tests for business logic and utility functions
2. Write integration tests for API routes and database interactions
3. Write E2E tests for critical user flows (auth, core feature paths)
4. Run the full test suite and fix any failures before proceeding

When all tests pass, ask:
> "All tests are passing. Ready to move to Stage 6 — Security Fixes?"

---

### Stage 6 — Security Fixes
**Skill:** `/security-foundation`
**Input:** Tested, passing codebase from Stage 5 + all engineering docs and specs
**Output:** `docs/security/security-plan.md` + `supabase/rls-policies.sql` + `src/lib/security/`

Review all engineering and spec documents, audit the codebase, identify every security surface, and implement all required security controls. Covers auth, protected routes, API validation, rate limiting, prompt injection protection, token limits, chat security, file upload security, environment variable protection, and audit logging.

When done, show the user what was created and ask:
> "Security fixes are complete. All controls are documented in `docs/security/security-plan.md` and the service files are ready in `src/lib/security/`. Ready to move to Stage 7 — Deploy?"

---

### Stage 7 — Deploy
**Input:** Security-hardened codebase from Stage 6
**Output:** Live production deployment

Steps:
1. Confirm environment variables are set in the deployment platform
2. Run the production build locally to catch any build errors
3. Deploy to Netlify, with Supabase as the database and environment variables configured in the Netlify dashboard. Every git push to main triggers an automatic redeploy.
4. Smoke test the live deployment against critical flows
5. Confirm the app is live and working

When deployed and verified, ask:
> "App is live. Ready to move to Stage 8 — Memory Layer?"

---

### Stage 8 — Memory Layer
**Input:** Deployed app from Stage 7
**Output:** Persistent, multi-turn conversation memory for the chat assistant

Give the chat assistant persistent memory so it can answer follow-up questions within a session and across page refreshes. The OpenAI API (Chat Completions, GPT-4o) is stateless — each call starts fresh with no memory of prior calls — so conversation history must be explicitly stored and loaded into the `messages[]` array on every request.

When done, show the user what was created and ask:
> "The memory layer is in place. The chat assistant now holds context across refreshes. Ready to move to Stage 9 — Evaluation?"

---

### Stage 9 — Evaluation
**Input:** Deployed app from Stage 8 + `eval/` (runners, datasets, red-team set)
**Output:** `eval/reports/<release>.json`

Run the evaluation suite against the deployed release and write one report per release. The report carries these metrics, each with a verdict of `PASS`, `FAIL` or `SKIPPED`:
- HHH (% helpful, % honest, % harmful — per the 29-question questionnaire)
- Extraction F1
- Page accuracy
- Confidence calibration
- Red-team pass rate
- Judge precision (and recall) against human `hhh_scores` rows

A metric that cannot be measured yet is `SKIPPED` with a reason — never `PASS`.

When done, show the user the report and ask:
> "Evaluation report is in `eval/reports/`. Ready to set launch thresholds?"

---

## Skills Reference

| Skill | Command | What it does |
|---|---|---|
| Engineering Planner | `/engineering-planner` | PRD → `docs/engineering/engineering-doc.md` |
| Implementation Specs | `/implementation-specs` | Engineering docs → granular spec files + `supabase-schema.sql` + `.env.example` |
| Frontend Setup | `/frontend-setup` | Scaffolds a Next.js 14 App Router project |
| Design System | `/design-system` | Enforces brand colors, typography, spacing, and component styles on all UI code |
| Security Foundation | `/security-foundation` | Implements all security controls → `docs/security/security-plan.md` + `supabase/rls-policies.sql` + `src/lib/security/` |

---

## Docs Reference

| File | Created by | Purpose |
|---|---|---|
| `docs/engineering/engineering-doc.md` | `/engineering-planner` | High-level architecture, flows, DB design, API spec |
| `docs/implementation/*.md` | `/implementation-specs` | Per-feature granular specs (flow, DB, API, component, edge cases) derived from the engineering doc |
| `docs/implementation/supabase-schema.sql` | `/implementation-specs` | Run this in Supabase SQL Editor to create all tables |
| `.env.example` | `/implementation-specs` | All environment variables — copy to `.env.local` and fill in values |
| `docs/security/security-plan.md` | `/security-foundation` | Security controls, audit log, RLS policies |
| `eval/reports/<release>.json` | Stage 9 — Evaluation | Per-release HHH, F1, page accuracy, calibration, red-team pass rate, judge precision — each PASS / FAIL / SKIPPED |

---

## Key Constraints

- **Never skip a stage.** Each stage depends on the output of the previous one.
- **Never proceed without user approval.** After every stage, stop and wait.
- **Never assume missing decisions.** Use `AskUserQuestion` when something is unclear.
- **Never write code before the specs exist.** Implementation only starts after Stage 2 is approved.