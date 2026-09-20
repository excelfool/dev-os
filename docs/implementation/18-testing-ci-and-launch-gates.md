# 18 — Testing, CI Pipeline and Launch Gates

**Sources:** engineering-doc §13 (all layers), §10 staged launch gates; PRD §11 launch criteria, §3 roadmap, §5 scalability.

---

## 1. Test layers

| Layer | Framework | Scope | Coverage target |
|---|---|---|---|
| **Unit** | Vitest + React Testing Library | `[PAGE N]` parsing and page attribution, token estimation, confidence conversion 0.0–1.0 → 0–100 and clamping, source-sentence verification and the confidence cap, colour-band boundaries (49/50, 79/80), custom-term validation and the 5-term cap, query classifier, citation parsing, cost calculation, error-code → user-message mapping, `targetPage` behaviour of **both** viewers | **≥ 85%** statements on `src/lib/**`; **100%** on `ai/`, `validation/`, `errors/` |
| **Hook / component state** | Vitest + `@testing-library/react` under `jsdom`, in `tests/hooks/` | React state interleavings that no other layer can order: a fetch resolving against a pending state update. Today: `useChat`'s mount-time history load landing mid-turn — once with the turn's own rows (which rendered the answer twice) and once empty (which wiped the user's question) — plus the merge of history that had not loaded when the turn began | Every such interleaving driven by hand, never by racing. **No `waitFor` on a condition the test itself controls** |
| **Integration** | Vitest + Supertest against the Route Handlers, backed by a **real local Supabase** (never a mocked DB) with a stubbed OpenAI client | Every endpoint in spec 12: happy path, each validation rejection (oversize, > 20 pages, > 15,000 tokens, non-PDF, scanned, corrupt), quota and rate-limit 429s, the Storage-failure path returning `201` with `storage_available: false`, OpenAI timeout / invalid-JSON paths leaving `status='error'` with **no partial terms**, retry after error without re-upload, cascade deletes, the `last_accessed_at` touch | **≥ 80%** of routes; **every** documented error code exercised at least once |
| **RLS / security** | Vitest against local Supabase with **two real test accounts** | Every table and Storage: B can neither read, update nor delete A's rows via the anon key; signed URLs expire; `rate_limits` is unreachable from a client; the built client bundle contains no server key names | **100% of tables and Storage policies.** This suite **gates the build** — it is the executable form of PRD Assumption 9 |
| **AI / eval** | Vitest + the `eval/` runners | Deterministic tests every PR (spec 17 §6); live-model runs every deploy: extraction F1, page accuracy ≥ 92%, custom-term F1 ≥ 80%, chat groundedness ≤ 5%, and the hallucination regression test; calibration monthly | A green regression suite is a release gate; a red metric **blocks the deploy** |
| **E2E** | Playwright (Chromium, Firefox, WebKit; desktop + mobile viewport) | sign-up → empty dashboard; sign-in → dashboard summary; upload → preview → custom term → process → results; page-chip click scrolls the viewer; inline edit shows the "Edited" badge **within 2 s**; chat question → answer with a clickable citation → refresh → history persists; text-viewer fallback with Storage disabled; scanned-PDF rejection message; delete contract removes all traces; export downloads (v1.1) | **All P0 and P1 stories** covered by at least one spec |
| **PDF rendering compatibility** | Playwright + a screenshot/heuristic harness over the **50-contract real-world corpus** (spec 17) | Each file: PDF.js renders every page without throwing, each page canvas is non-blank, and the page count matches `pdf-parse`. Any failing file **must degrade correctly** — the text viewer takes over **and** the "Download PDF" link is present, with the failure recorded | **≥ 95%** of the corpus renders cleanly; **100% of the remainder must hit the fallback path**. A file that neither renders nor falls back **blocks the release**. Run during beta and re-run on every `pdfjs-dist` upgrade |
| **Accessibility** | axe-core via Playwright | Every page and both viewers, light and dark; keyboard-only traversal of the full core flow; focus management in modals | **Zero serious/critical violations — a CI gate** |
| **Performance** | k6 + a Playwright timing spec | **100 concurrent analyses** sustained without error-rate or latency degradation; P95 end-to-end ≤ 30 s; chat P95 ≤ 15 s; a headroom run at **1,000 concurrent users** validating the horizontal-scaling claim | Reported per release; a regression blocks launch |

**Why the hook layer exists (added 2026-09-20).** The chat panel rendered one
turn's answer twice, roughly two runs in five. The cause was inside `useChat`:
the mount-time history GET applied its result unconditionally, so a load that
landed mid-turn overwrote state the turn was still building on. Neither existing
layer can reach that. Integration tests call the Route Handlers directly and
have no hook at all. Playwright cannot order a promise resolution against a
React state update from outside the browser — three attempts to force the
interleaving failed, because React StrictMode issues two loads per mount and the
live effect is not reliably the second to resolve. Deferring both fetches inside
the hook's own environment makes the order stated rather than raced for, and the
bug reproduced on the first run.

RTL was already named in the Unit row of the table above but was never
installed; `jsdom` and `@testing-library/react` are now devDependencies.

---

## 2. Local test environment

- `supabase start` provides the local stack; `supabase/database.sql` is applied to it before every run, so the tests always exercise the same schema that ships.
- The OpenAI client is stubbed at the `callLlm` boundary for unit/integration/E2E — fixtures return canned JSON, timeouts and malformed payloads on demand. **Only the eval layer calls the live model.**
- Two seeded test accounts (A and B) for the RLS suite, each using the **anon** key.
- Storage-failure simulation: an env flag makes `contract-service` treat the Storage upload as failed, which is how the `storage_available: false` path and the text-viewer fallback are tested deterministically.

---

## 3. CI pipeline

**Every PR:** typecheck → lint → unit → hook → integration (local Supabase) → RLS suite → deterministic AI tests → build → **client-bundle secret scan** → axe-core → Playwright E2E.

**On merge to `main`:** the live-model eval regression suite and the k6 smoke run, with results archived to `eval/reports/`.

**Scheduled (spec 14 §4):** the nightly low-confidence invariant job during beta; weekly drift check; monthly calibration run and legal-SME audit; daily cost rollup and correction-rate check; and the 5-minute `reclaim-stale-processing` job.

Any red step blocks the merge. The RLS suite, the secret scan and axe-core are hard gates with no override.

---

## 4. Staged launch gates

No stage is entered until **every** criterion of the previous stage is evidenced by its named measurement source.

### Internal Alpha (team only, end of v0.2)
| Criterion | Evidence |
|---|---|
| Core upload → extract → display works end-to-end without crashes | `contract-review.spec.ts` green on all three Playwright browsers across **10 consecutive runs**; zero unhandled exceptions in Netlify function logs over a **48-hour** team dogfood window |
| Basic extraction working (Helpful) | `term-coverage.ts` ≥ 80% on a 5-contract smoke set (the full labelled-set run of the same runner is the v0.2 acceptance evidence for US-002) |
| Source sentences shown (Honest) | `disclaimer.spec.ts` + a `WhySection` assertion: every rendered term exposes a non-empty `source_sentence` or is explicitly marked "Not found in document" |
| Disclaimer present (Harmless) | `disclaimer.spec.ts` asserts `DisclaimerBanner` on every results page |

### Measurement Beta (≤ 50 users, end of v0.4)
| Criterion | Evidence |
|---|---|
| ≥ 75% user satisfaction | `SELECT count(*) FILTER (WHERE survey_accuracy='yes')::float / count(*) FROM user_feedback WHERE survey_accuracy IS NOT NULL` ≥ 0.75 |
| Correction rate ≤ 20% | `term_corrections` count ÷ total `key_terms` over the beta window |
| **0 incidents of misleading output without a confidence warning** | Both parts required: **(a)** an automated invariant test asserting that **every** `key_terms` row with `confidence_score < 50` renders the ⚠️ icon **and** the non-dismissible tooltip **and** is never hidden — run against **every beta contract, not a sample**, via the **nightly low-confidence invariant job scheduled in spec 14 §4** (03:30 UTC during beta), which reuses the assertion module from `low-confidence-invariant.test.ts` over production rows and writes `eval/reports/low-confidence-invariant-<date>.json`; **(b)** a manually triaged incident log where any user-reported wrong value is checked against its stored `confidence_score` — a wrong value that displayed **≥ 50%** confidence counts as an incident, and the count must be **zero** |
| No P0 bugs | Issue tracker query: zero open P0s at the gate |
| Latency ≤ 45 s P95 | `processing_runs.duration_ms` P95 `WHERE stage='total'` over the beta window |
| F1 ≥ 82% | Per-release eval report in `eval/reports/` |
| Standard-term value coverage ≥ 80% (US-002) | `term-coverage.ts` over the 30 NDA + 20 MSA labelled set, in the same report |
| PDF rendering verified | The 50-contract rendering-compatibility harness meets its pass criteria |

### Public Launch (end of v1.0)
F1 ≥ 88% NDA / ≥ 85% MSA; calibration error ≤ 0.10; correction rate ≤ 12%; ≥ 80% satisfaction; latency ≤ 30 s P95; security audit passed and RLS verified; **Supabase Pro provisioned**; **Art. 28 DPAs confirmed with BOTH OpenAI and Supabase** (engineering-doc Appendix B; PRD §11 — both are required before EU onboarding); legal disclaimer approved; ToS and privacy pages live.
Evidence: the v1.0 feature acceptance rows (spec 19), plus the RLS cross-account suite green in CI, the client-bundle secret scan green, axe-core zero serious/critical, k6 sustaining 100 concurrent analyses, and the same eval report and telemetry queries as the beta gate at the tighter thresholds.

---

## 5. External dependencies verified by tests

| Dependency | Risk | Test that covers it |
|---|---|---|
| OpenAI availability | Outages block processing | Integration: 3 retries then `status='error'` + Retry CTA without re-upload |
| OpenAI pricing changes | Cost above $0.25/analysis | `cost.test.ts` + the daily rollup alert drill at 80% of budget |
| Supabase free-tier limits | Breach at ~200 contracts | Weekly storage check at 70%; Pro provisioning is a launch gate |
| PDF.js rendering compatibility | Unusual fonts/layouts fail | The 50-contract rendering harness with a mandatory fallback path |
| Browser file API limits | Large PDFs on low-end devices | The device advisory banner + the mobile-viewport E2E run |
