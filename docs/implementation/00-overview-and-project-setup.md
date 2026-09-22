# 00 — Overview, Stack and Project Setup

**Sources:** PRD §6, §13; engineering-doc §5.1, §6.1, §11, §12.
**Scope of this file:** what the app is, the exact dependency set, how the existing scaffold differs from the target, config files verbatim, and the order in which the other specs are built.

---

## 1. What is being built

ContractIQ — an AI-assisted NDA/MSA review tool. A signed-in user uploads a text-layer PDF (≤ 10 MB, ≤ 20 pages, ≤ 15,000 tokens), the server extracts the text once at upload with `[PAGE N]` markers, GPT-4o extracts the standard key terms for the selected contract type plus up to 5 user-defined custom terms, and the results page shows a document viewer alongside a key-terms panel with value, page number, confidence score and the verbatim source sentence. The user can correct terms inline, chat with the contract (grounded strictly in the stored text, with mandatory `[Page X]` citations), and see all past reviews on a dashboard.

**Inference provider: OpenAI GPT-4o via the OpenAI API, for both key-term extraction and chat.** Claude and Gemini appear in the PRD only as unwired cost-contingency options; no Anthropic or Google client is installed, configured or referenced anywhere in the codebase (engineering-doc §8.5 — the `LlmProvider` interface exists so a future swap is an adapter change, but no fallback provider is wired at MVP).

---

## 2. Settled architectural decisions (do not reopen)

| Ref | Decision |
|---|---|
| A-01 | Frontend: **Next.js 14 App Router, TypeScript strict**. Not a Vite SPA. |
| A-02 | Backend: **Next.js Route Handlers (Node runtime) on Netlify** for every request/response API. **Supabase Edge Functions only for scheduled/background jobs with no latency budget** — at MVP those are `purge-expired-pdfs` (scheduled, spec 11 §2) and `send-notification` (background, invoked off the request path, spec 14 §2a). |
| A-05 | Email confirmation: both paths implemented; **MVP default OFF** (`NEXT_PUBLIC_EMAIL_CONFIRMATION_ENABLED=false` mirrors the Supabase toggle). `/auth/callback` ships regardless. |
| A-06 | Billing: **no payment provider at MVP**. `profiles.plan` + quota enforcement only; plan changes are operator-set via the Supabase dashboard. |
| A-07 | **Supabase Realtime is not used.** Chat is a single request/response turn returning the complete answer. |
| A-16 | Export is available on **Free Trial, Growth and Pro**; withheld from **Starter after the trial ends**. Export itself is a v1.1 feature (spec 15). |
| A-03 | Chat passes the **full** conversation history (≤ 200 messages, ascending), not the last 10 turns. |
| A-04 | Model returns confidence `0.0–1.0`; the service converts once and persists an integer `0–100`. |

---

## 3. Current scaffold vs. target — divergences to fix first

The repository currently contains a bare scaffold at `nextjs-app/`:

```
nextjs-app/
├─ app/{layout.tsx,page.tsx,globals.css}
├─ package.json          # next 14.2.5, react 18.3.1 — nothing else
├─ tsconfig.json
└─ next.config.mjs
```

| Divergence | Required action |
|---|---|
| App code lives in `app/`, target is `src/app/` | Move: `mkdir -p src && git mv app src/app`. Set `tsconfig.json` path alias `"@/*": ["./src/*"]`. |
| No Tailwind, no design tokens | Install Tailwind + PostCSS; create `tailwind.config.ts` per spec 16. |
| No shadcn/ui | `npx shadcn@latest init`, then add the primitives listed in §4 below. |
| No TanStack Query | Install `@tanstack/react-query` and mount `QueryClientProvider` in `src/app/providers.tsx`. |
| No zod / react-hook-form | Install both; schemas live in `src/lib/validation/`. |
| No Supabase client | Install `@supabase/supabase-js` and `@supabase/ssr`; create the four clients in `src/lib/supabase/`. |
| No pdf tooling | Install `pdfjs-dist` (client render) and `pdf-parse` (server extract). Copy `pdf.worker.min.mjs` into `public/`. |
| `next.config.mjs` present, doc names `next.config.js` | Keep `.mjs`; it is the same file with ESM syntax. Security headers go here (spec 13). |
| No `src/middleware.ts` | Create it (spec 03). |
| No `netlify.toml` | Create it (§6 below). |
| No test tooling | Install Vitest, RTL, Playwright, axe-core (spec 18). |
| No `supabase/` directory | Create `supabase/functions/purge-expired-pdfs/` (spec 11) and `supabase/functions/send-notification/` (spec 14 §2a). |
| No `.env.example` at root | Copy `docs/implementation/.env.example` to the project root. |

Rename the project directory reference in docs as `contractiq/`; the physical folder may stay `nextjs-app/`. No spec depends on the folder's own name.

### 3a. Deferred setup items (tracked, not yet done)

| Item | Why deferred | Unblocks when |
|---|---|---|
| **`purge-expired-pdfs` pg_cron job** (`supabase-schema.sql` §17) | Needs the real `<PROJECT_REF>` substituted **and** `select vault.create_secret('<SERVICE_ROLE_KEY>', 'service_role_key');` run by an operator, and it invokes an Edge Function that does not exist yet. Scheduling it early would create a job that fails nightly. | The `purge-expired-pdfs` Edge Function ships (spec 11 §2). The `reclaim-stale-processing` job **is** scheduled — it is pure SQL with no external dependency. |
| **`z.coerce.boolean()` in spec 01 §1** | `Boolean('false') === true` in JS, so `CALIBRATION_WARNING_ACTIVE=false` would switch the flag **on**. Implemented instead as a literal `=== 'true'` check in `src/lib/utils/config.ts`. | Done — no action outstanding. This row records the deliberate deviation from the spec text. |
| **`pdf-parse` is v2, not v1** | §4 above and spec 04 §3 are written against pdf-parse v1, whose `pagerender` callback was the only way to keep page boundaries exact. npm installs **v2.4.5**, which removed that callback and instead returns page-wise text natively as `TextResult.pages[]` via a `PDFParse` class. `src/lib/pdf/extract-text.ts` is written against the v2 API, which satisfies the same "page boundaries must be exact, not guessed from form feeds" requirement more directly. `@types/pdf-parse` (v1 types) was removed — v2 ships its own. No version was pinned in §4, so this is a deviation from the spec's prose, not from its dependency list. | Done — verified live: a 3-page fixture yields exactly 3 markers with correct boundaries, and a truncated PDF throws. |
| **shadcn/ui via `npx shadcn@latest init`** | Primitives needing Radix (select, dialog, tooltip, dropdown-menu, sheet, tabs) are installed when the first feature requires them. Slice 2 needs only button/input/label/card, which are plain accessible HTML and are hand-written to the same API. | Slice 3 (`Select` for contract type) and Slice 5 (`Tooltip`, `Dialog`). |
| **`next@14.2.5` advisories** | `npm audit` reports a critical advisory chain against 14.2.5. The version is pinned by §4 above and is left as specified. | An explicit decision to move to a later 14.2.x. |

---

## 4. Dependency set (exact)

```bash
# runtime
npm i @supabase/supabase-js @supabase/ssr \
      @tanstack/react-query \
      zod react-hook-form @hookform/resolvers \
      openai \
      pdf-parse pdfjs-dist \
      js-tiktoken \
      clsx tailwind-merge class-variance-authority lucide-react \
      date-fns

# dev
npm i -D tailwindcss postcss autoprefixer \
         vitest @vitejs/plugin-react @testing-library/react @testing-library/jest-dom jsdom \
         @playwright/test @axe-core/playwright \
         supertest @types/supertest \
         @types/pdf-parse \
         eslint eslint-config-next prettier prettier-plugin-tailwindcss

# shadcn primitives actually used
npx shadcn@latest add button input label select dialog dropdown-menu tooltip \
      badge card table skeleton toast alert tabs sheet separator textarea switch
```

Pinned notes:
- `openai` — the official OpenAI Node SDK; used only in `src/lib/ai/openai-client.ts`.
- `js-tiktoken` — pure-JS tokenizer, encoding `o200k_base`, used for `token_estimate`. Chosen over native `tiktoken` because Netlify Functions must stay dependency-light and cold-start-fast.
- `pdf-parse` requires the Node runtime — every route that imports it declares `export const runtime = 'nodejs'`.

---

## 5. Target folder structure

Build exactly the tree in engineering-doc §11. Reproduced here as the authority for file placement:

```
src/
├─ app/
│  ├─ (marketing)/page.tsx                  landing (static)
│  ├─ (marketing)/legal/terms/page.tsx
│  ├─ (marketing)/legal/privacy/page.tsx
│  ├─ (auth)/login/page.tsx
│  ├─ (auth)/signup/page.tsx
│  ├─ (auth)/auth/callback/route.ts        -> serves /auth/callback (a route group
│  │                                          adds no path segment, so the literal
│  │                                          `auth` segment is required)
│  ├─ (app)/layout.tsx                      authed shell: nav, status banner, footer
│  ├─ (app)/dashboard/page.tsx
│  ├─ (app)/settings/page.tsx
│  ├─ (app)/contracts/new/page.tsx
│  ├─ (app)/contracts/[id]/page.tsx
│  ├─ (app)/contracts/[id]/prepare/page.tsx
│  ├─ api/contracts/route.ts                GET list
│  ├─ api/contracts/upload/route.ts         POST
│  ├─ api/contracts/[id]/route.ts           GET, DELETE
│  ├─ api/contracts/[id]/process/route.ts   POST
│  ├─ api/contracts/[id]/chat/route.ts      GET, POST
│  ├─ api/contracts/[id]/signed-url/route.ts POST
│  ├─ api/contracts/[id]/complete/route.ts  POST
│  ├─ api/contracts/[id]/export/route.ts    GET (v1.1)
│  ├─ api/contracts/[id]/custom-terms/route.ts            POST
│  ├─ api/contracts/[id]/custom-terms/[termId]/route.ts   DELETE
│  ├─ api/key-terms/[id]/route.ts           PATCH
│  ├─ api/feedback/route.ts                 POST
│  ├─ api/nps/route.ts                      POST
│  ├─ api/account/route.ts                  DELETE
│  ├─ api/system-status/route.ts            GET
│  ├─ api/health/route.ts                   GET
│  ├─ layout.tsx, providers.tsx, globals.css, error.tsx, not-found.tsx
├─ components/{ui,layout,auth,dashboard,upload,terms,viewer,chat,feedback}/
├─ lib/
│  ├─ supabase/{client.ts,server.ts,admin.ts,middleware.ts}
│  ├─ ai/{openai-client.ts,term-library.ts,query-classifier.ts}
│  ├─ ai/prompts/{extraction.v1.ts,chat.v1.ts,repair.v1.ts}
│  ├─ services/{contract-service.ts,extraction-service.ts,chat-service.ts,
│  │            feedback-service.ts,analytics-service.ts,retention-service.ts,
│  │            export-service.ts}
│  ├─ pdf/{extract-text.ts,page-utils.ts}
│  ├─ validation/{upload.schema.ts,custom-term.schema.ts,chat.schema.ts,
│  │              key-term.schema.ts,feedback.schema.ts,nps.schema.ts,
│  │              contracts-query.schema.ts}
│  ├─ security/{rate-limit.ts,quota.ts,concurrency.ts,headers.ts}
│  ├─ errors/{app-error.ts,error-codes.ts,to-user-message.ts}
│  ├─ metrics/{timings.ts,cost.ts,events.ts}
│  └─ utils/{format.ts,normalise-text.ts,cn.ts,config.ts}
├─ hooks/{use-contract.ts,use-key-terms.ts,use-chat.ts,use-upload.ts,
│         use-target-page.ts,use-analytics.ts}
├─ types/{database.types.ts,domain.ts,api.ts}
└─ middleware.ts
supabase/functions/purge-expired-pdfs/index.ts
supabase/functions/send-notification/index.ts
scripts/{scan-client-bundle.mjs,notify-incident.ts}
eval/{datasets,runners,reports}/
tests/{unit,integration,rls,ai,e2e}/
public/{demo.gif,pdf.worker.min.mjs}
```

---

## 6. Config files

### `tsconfig.json` (required settings)

```jsonc
{
  "compilerOptions": {
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "target": "ES2022",
    "lib": ["dom", "dom.iterable", "ES2022"],
    "module": "esnext",
    "moduleResolution": "bundler",
    "jsx": "preserve",
    "incremental": true,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "allowJs": true,
    "noEmit": true,
    "plugins": [{ "name": "next" }],
    "paths": { "@/*": ["./src/*"] }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

### `netlify.toml`

```toml
[build]
  command = "npm run build"
  publish  = ".next"

[[plugins]]
  package = "@netlify/plugin-nextjs"

[build.environment]
  NODE_VERSION = "20"

[functions]
  node_bundler = "esbuild"
  external_node_modules = ["pdf-parse"]

# Upload and process are the two long-running routes. Netlify's function
# timeout is 10s on the free tier and 26s on Pro; ContractIQ requires Pro.
# /api/contracts/[id]/process enforces its own 24s deadline in code so it can
# never be killed mid-run — see spec 06 §3a. Retries are skipped rather than
# allowed to exceed the ceiling.
[functions."api/contracts/[id]/process"]
  included_files = []
```

`npm run build` must fail the build if `next build` emits any type error — do not set `typescript.ignoreBuildErrors`.

### `package.json` scripts

```json
{
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "next lint",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:unit": "vitest run tests/unit",
    "test:integration": "vitest run tests/integration",
    "test:rls": "vitest run tests/rls",
    "test:ai": "vitest run tests/ai",
    "test:e2e": "playwright test",
    "eval": "tsx eval/runners/run-all.ts",
    "db:types": "supabase gen types typescript --project-id $SUPABASE_PROJECT_REF > src/types/database.types.ts",
    "scan:secrets": "node scripts/scan-client-bundle.mjs"
  }
}
```

### `scripts/scan-client-bundle.mjs` (CI gate, engineering-doc §12)

Walks `.next/static/**/*.js` and fails with exit code 1 if any file contains the literal strings `SUPABASE_SERVICE_ROLE_KEY`, `OPENAI_API_KEY`, `sk-`, or the value of `SUPABASE_SERVICE_ROLE_KEY` when that env var is set.

---

## 7. Naming conventions (engineering-doc §12 — binding)

Directories kebab-case, route groups in parentheses. React components PascalCase `.tsx`, one per file. Other modules kebab-case `.ts`. Hooks `use-<name>.ts` exporting `use<Name>`. Services `<domain>-service.ts` exporting verb-first functions. Zod schemas `<subject>.schema.ts` exporting `<subject>Schema` and `type <Subject>Input`. DB tables snake_case plural; columns snake_case with `is_`/`has_` boolean prefixes, `_at` timestamps, `_ms` durations. Indexes `idx_<table>_<columns>`. Policies `<table>_<verb>_own`. Triggers `on_<event>` or `<verb>_<noun>`. Enum-like values lowercase snake_case **except** `contract_type`, which is uppercase `NDA` / `MSA`. Env vars SCREAMING_SNAKE_CASE; only `NEXT_PUBLIC_*` reaches the browser. Tests `<subject>.test.ts` (unit/integration) and `<flow>.spec.ts` (E2E). Prompts `<task>.v<major>.ts`. Branches/commits `feat|fix|chore/<story-id>-<slug>` with Conventional Commits.

---

## 8. Build order

Each spec is self-contained; build in this order because each depends only on the ones before it.

| Order | Spec | Delivers |
|---|---|---|
| 1 | `supabase-schema.sql` + `02-database-and-rls.md` | Schema, RLS, Storage bucket |
| 2 | `01-configuration-and-shared-libraries.md` | Config, errors, supabase clients, utils |
| 3 | `03-auth-landing-and-legal.md` | US-001, middleware, landing, legal pages |
| 4 | `04-upload-and-text-extraction.md` | US-002, FR-02/FR-03 |
| 5 | `05-term-library-preview-and-custom-terms.md` | Preview, US-005 |
| 6 | `06-extraction-pipeline.md` | US-011-partial, US-003, US-004, FR-11 |
| 7 | `07-results-page-viewers-and-editing.md` | US-006, FR-06, FR-07, US-009 |
| 8 | `08-contract-chat.md` | US-007, US-012, FR-08, FR-09 |
| 9 | `09-dashboard-and-history.md` | US-008, FR-10 |
| 10 | `10-feedback-nps-and-review-completion.md` | US-010, FR-12, North Star timer |
| 11 | `11-retention-deletion-and-gdpr.md` | Deletion, 90-day purge, account erasure |
| 12 | `12-api-reference.md` | Cross-cutting contract for every route |
| 13 | `13-security-rate-limiting-and-quota.md` | Rate limits, quota, concurrency, headers |
| 14 | `14-observability-telemetry-and-incidents.md` | Health, status banner, cost/latency telemetry |
| 15 | `15-export-and-post-mvp-features.md` (v1.1) | US-011 |
| 16 | `16-design-system-and-accessibility.md` | Tokens, states, WCAG 2.1 AA |
| 17 | `17-evaluation-suite.md` | Eval runners, datasets, report schema |
| 18 | `18-testing-ci-and-launch-gates.md` | Test layers, CI pipeline, launch gates |
| 19 | `19-requirements-traceability.md` | Every PRD/eng-doc requirement → spec location |

---

## 9. Release schedule (PRD §3 Roadmap · engineering-doc §10)

The 14-week MVP plan, with the spec files each release consumes. Capacity assumption (PRD Assumption 7): **2–3 engineers + 1 PM full-time**; each release is sized so the **lead fullstack engineer** works the API/service/DB column while the **frontend engineer** works the component column in parallel, with QA/DevOps at 0.5 FTE across all of them.

| Release | Weeks | Scope | Specs | Lead fullstack | Frontend |
|---|---|---|---|---|---|
| **v0.1 Foundation (MEP)** | 1–2 | Supabase project + full schema; static landing page; email/password auth; redirect to dashboard; empty dashboard state | `supabase-schema.sql`, 02, 01, 03, 09 §2 | Schema, RLS, Storage, Supabase clients, middleware | Landing, auth forms, app shell, empty state |
| **v0.2 Core Review Flow** | 3–5 | Upload + type selector; `pdf-parse` extraction; GPT-4o extraction (standard terms); key terms panel; low-confidence warning; results persisted | 04, 06, 07 §4 | Upload route, extraction service, prompts, `persist_key_terms` | Dropzone, progress steps, terms panel, confidence badge |
| **v0.3 Enriched Experience** | 6–8 | Term preview; custom terms (≤ 5); PDF.js viewer; click-to-navigate; "Why?" source sentence | 05, 07 §§2–4 | Term library, custom-terms routes + trigger, signed URLs | Preview list, custom-term input, both viewers, page chips |
| **v0.4 Chat & History** | 9–11 | Contract chat; persistent chat history; dashboard history; inline term editing; error states | 08, 09, 07 §5, 01 §2 | Chat service, classifier, citation validation, list route | Chat panel, message list, contracts table, inline editor |
| **v1.0 Launch** | 12–14 | Feedback; performance optimisation; security audit; WCAG 2.1 AA review; rate limiting and cost controls; onboarding tooltips; retention and deletion | 10, 13, 14, 16, 11, 18 | Rate limit/quota/concurrency, telemetry, retention job, audit | Feedback widget, NPS, onboarding tips, a11y fixes |
| **v1.1 Post-Launch** | 15–18 | CSV + PDF export; batch upload (≤ 5); dashboard analytics charts; public trust page | 15 §§1–2 | Export service, batch queue | Export button, charts, trust page |
| **v1.2 Growth** | 19–24 | OCR for scanned PDFs; contract comparison; completion emails; multi-user workspace; non-US few-shot examples | 15 §3 | OCR vendor, workspace RLS migration | Comparison view |

**Dependencies that must land before their release ships:** OpenAI API access and approved usage terms before v0.2; **Supabase Pro** before v1.0 (beta); legal review of the ToS and DPA before the v1.0 public launch; the GDPR DPA with OpenAI confirmed before EU user onboarding.

---

## v1.1 amendments (PRD v1.1, 2026-09-21)

### A. §1 — what is being built, extended

Every term now also carries a one-sentence **reasoning**; the extraction prompt asks each term's **question** (NDA 10 terms, MSA **36** instructor terms); a plain-language **summary** is generated per contract; and every instructor capability not yet built exists as an honest placeholder — registry entry, adapter interface + NullAdapter, table with RLS, 501 route, SKIPPED eval row, hidden/empty UI (PRD Appendix A). The settled decision "OpenAI is the sole inference provider" stands; model ids are now configurable per purpose (`model.extraction`, `model.chat`, `model.summary`, `model.enhancer`, `model.judge`) and the judge, when configured, is a stronger OpenAI model never used in a product prompt.

### B. §5 folder tree — additions

```
src/app/(app)/settings/playbooks/page.tsx                 PlaybookAdmin (read-only stub)
src/app/api/capabilities/route.ts                         GET
src/app/api/contracts/[id]/risks/route.ts                 POST 501
src/app/api/contracts/[id]/escalate/route.ts              POST 501
src/app/api/contracts/[id]/compare/route.ts               POST 501
src/app/api/contracts/[id]/push/[target]/route.ts         POST 501
src/app/api/contracts/[id]/key-dates/route.ts             GET
src/app/api/contracts/[id]/summary/route.ts               POST
src/app/api/key-dates/[id]/reminders/route.ts             PATCH
src/app/api/risk-flags/[id]/route.ts                      PATCH 501
src/app/api/playbooks/route.ts, playbooks/[id]/route.ts   GET/POST/PATCH 501
src/app/api/webhooks/esign/route.ts                       POST 501 (public)
src/app/api/import/[source]/route.ts                      POST 501
src/app/api/integrations/route.ts                         GET (live, empty list until a vendor is built)
src/app/api/integrations/[target]/route.ts                DELETE 501
src/app/api/integrations/[target]/connect/route.ts        POST 501 (OAuth start)
src/app/api/integrations/[target]/callback/route.ts       GET (OAuth callback; 501 until built)
src/app/api/hhh-scores/route.ts                           PUT
src/app/api/eval/sample-week/route.ts                     GET
src/components/{risk,capabilities,review,reminders,summary}/
src/lib/capabilities.ts
src/lib/integrations/{types.ts, crm, ocr, docx, esign, import, email, redline, graph, rag}/{types.ts,null-adapter.ts,index.ts}
src/lib/ai/retrieval/{types.ts,full-context.ts,vector-rag.ts,graph-rag.ts,n8n.ts}
src/lib/ai/{query-enhancer.ts,playbook-vocab.ts}
src/lib/ai/prompts/{extraction.v2.ts,summary.v1.ts,query-enhancer.v1.ts,risk.v1.ts}
src/lib/ai/term-library/msa-instructor.json               synced copy of docs/reference/key-terms-msa-instructor.json
src/lib/security/{guardrails.ts,patterns/,profanity-list.ts,competitors.ts}
src/lib/services/{reminder-service.ts,summary-service.ts,crm-push-service.ts}
src/lib/validation/{hhh-score.schema.ts,key-dates.schema.ts,playbook.schema.ts,escalation.schema.ts}
supabase/functions/send-due-reminders/index.ts            written, undeployed
scripts/{review-guardrails.ts,set-cohort.ts,daily-ops.ts,sync-refs.mjs}
eval/lib/{golden-set.ts,matcher.ts,hhh-codes.ts,expect.ts}
eval/scripts/ingest-golden-set.ts                          uploads the 10 golden-set PDFs under the eval account; writes manifest.json
eval/datasets/msa-instructor/{golden-set.json,README.md,manifest.json,pdfs/}   pdfs/ git-ignored
eval/runners/{risk-f1,hhh-human,hhh-judge,judge-precision,redteam,wrong-tool-calls,mep-acceptance,sample-week,satisfaction,ocr-accuracy}.ts
eval/prompts/judge.v1.ts
eval/redteam/attacks.json
eval/export/{hhh-sheet.ts,foundry.ts,corrections.ts}
eval/failures/{curate.ts,to-synthetic.ts,<prompt_version>/…}
eval/datasets/README.md                                    provenance of the synthetic corpus (generator prompt, date, the two known Notice-Period label errors)
eval/datasets/{msa-instructor,synthetic,risk-labels,ocr-sample}/ + hhh-questionnaire.csv
```

`package.json` scripts add `"eval:sync-refs": "node scripts/sync-refs.mjs"` (copies the two reference files) and `"eval:redteam": "tsx eval/runners/redteam.ts"`.

### C. §8 build order — additions

| Order | Spec | Delivers |
|---|---|---|
| 20 | `20-risk-and-playbook.md` | Placeholder tables, seed playbook, 501 routes, RiskPanel/EscalateOffer/PlaybookAdmin states, `risk-f1` SKIPPED |
| 21 | `21-integrations-and-capability-registry.md` | Registry, `/settings` table, 501 contract, adapters + NullAdapters, `integration_events`, key dates + reminders |
| 22 | `22-evaluation-hhh-judge-and-redteam.md` | `hhh_scores`, Review mode, judge runners, red team, exports, golden set, failure pool |
| 23 | `23-observability-alerts-and-rollout.md` | `guardrail_events`, alert rules + nightly job, cohorts, KPI views |

The schema section (order 1) now includes the v1.1 additions; the registry (21 §1) is built in v0.1 alongside the schema (PRD roadmap v0.1 "placeholder tables per P-3; capability registry (P-1)").

### D. §9 release schedule — additions per PRD v1.1 roadmap

v0.1 + placeholder tables and registry (21 §1–3, schema v1.1) · v0.2 renamed **MEP** + 36-term question-based extraction, reasoning, `mep-acceptance.ts` (05/06 v1.1, 22 §8) · v0.3 + summary (06 v1.1 §B, 07 v1.1 §B) · v0.4 + query enhancer, page/reasoning editing, **red-team seed set + `redteam.ts` (first run against the new chat endpoint; Alpha checkpoint B)** (08 v1.1 §B, 07 v1.1 §D, 22 §9, 18 v1.1 §B) · v1.0 + red team on every deploy as a hard gate, `guardrail_events` + `alert_rules` stub, rollout cohorts stub (22 §9, 23) · v1.1 + DOCX (stub → built), key-date reminders (21 §4, §7) · v1.2 + OCR (< 80% ⇒ re-upload), `compare.contracts` 501, `esign.docusign` stub · v2 planned keys only.
