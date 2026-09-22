# Handoff — final state after deployment

**Date:** 2026-09-20
**State:** Stages 1–7 complete. The app is **live** at
https://contractiqlab.netlify.app (Netlify site `contractiqlab`, Supabase project
`bumjoxthlkdvvrcollut`), deployed from commit `e63da55`. Every git push to
`main` redeploys. Stage 8 (memory layer) was delivered inside Stage 4/5: chat
history persists across refresh and sessions and the four-turn memory test
passes live in a browser.
**Verification at handoff:** `npm test` → **211 passing** (17 files: unit, hook,
RLS, integration). `npx playwright test` → **77 passing, 3 skipped** (Chromium +
WebKit; the skips are the tablet-tabs fixme on each engine and the WebKit
keyboard run). `npm run build`, `npm run scan:secrets`, `npx tsc --noEmit` all
clean. Eval suite (spec 17) built and run; `docs/testing/testing-report.md` is
10/10 against the running app. Live upload verified against the deployed
function after the last fix (201, `x-nf-request-id 01M30YBS9PQ47NGG1J521YRRMC`).

Read §3 (open items) and §3a (production fixes) before anything else. §4 still
matters if you touch the UI or the CSP.

---

## 1. What exists

Everything lives in `nextjs-app/` (the doc-level name is `contractiq/`; no spec
depends on the folder name). Supabase project `bumjoxthlkdvvrcollut`.

### Slice 0-1 — foundation and shared libraries
`app/` → `src/app/`, `@/*` → `./src/*`, Tailwind with the full `docs/design.md`
token set, security headers, `netlify.toml`, the client-bundle secret scanner.
The 847-line schema applied and verified: **14 tables, RLS on all 14**, private
`contracts` bucket with 3 storage policies, 34 policies, 100 analysis slots,
`reclaim-stale-processing` cron live. Then `config.ts`/`server-config.ts`, the
27-code error taxonomy, four Supabase clients, `normalise-text`, metrics,
domain types, seven zod schemas.

### Slice 2 — auth, shell, landing, legal
Middleware (layer 1 of 3), landing page, `/legal/terms`, `/legal/privacy`,
`/signup`, `/login`, `/auth/callback`, authed shell with status banner,
`/settings`, dashboard empty state. `quota.ts` was built here because settings
needs it; Slice 3 enforces with the same module.

### Slice 3 — upload and text extraction
`rate-limit.ts`, `concurrency.ts`, `extract-text.ts` (the `[PAGE N]` contract),
`page-utils.ts`, the ten-step upload gate, `/contracts/new` with client
pre-checks, determinate progress and a `useReducer` wizard context.

### Slice 4 — term library and extraction
The 10 NDA / 12 MSA library (v1.0 — superseded by the 10 NDA / 36 MSA instructor library, `TERM_LIBRARY_VERSION` v1.1, see HANDOFF-stage6.md), `openai-client.ts` with deadline-aware retries,
the few-shot extraction prompt, the eight-step post-processing pipeline,
`/process` with its 24s deadline and stale-run reclaim, custom-terms routes,
`/contracts/[id]/prepare`, `ProcessingSteps`.

### Slice 5 — results page
Both viewers behind one `DocumentViewerProps` contract, `PdfViewer` with local
worker and `IntersectionObserver` lazy rendering, `TextViewer` with an
offset-mapped highlighter, `useTargetPage`, terms panel, confidence bands,
`WhySection`, inline editing, `GET /api/contracts/{id}`, `signed-url`,
`PATCH /api/key-terms/{id}`, all four banners.

### Slice 6 — contract chat
Deterministic classifier, chat prompt, context assembly with full history and
oldest-first truncation, `[Page X]` enforcement with one repair retry,
`GET`/`POST /api/contracts/{id}/chat`, `ChatPanel`, `useChat`.

### Slice 7 — dashboard, feedback, retention
`GET /api/contracts` (sort/filter/page), `DELETE /api/contracts/{id}`,
`/complete`, `/api/feedback`, `/api/nps`, `/api/account`, `/api/health`,
`ContractsTable`, `FeedbackWidget`, `NpsSurvey`, `CompleteReviewButton`,
`DangerZone`, and both Edge Functions (`purge-expired-pdfs`,
`send-notification`).

**17 of 18 routes in spec 12 exist.** The missing one is
`GET /api/contracts/{id}/export`, which spec 15 scopes to v1.1.

---

## 2. Spec deviations — all deliberate, all recorded in the specs themselves

Each is also annotated at its call site in code. This table is the index.

| # | Deviation | Spec | Why | Recorded in |
|---|---|---|---|---|
| 1 | **`z.coerce.boolean()` replaced with `=== 'true'`** | 01 §1 | `Boolean('false') === true` in JS, so `CALIBRATION_WARNING_ACTIVE=false` would switch the flag **on** and render the recalibration notice permanently. | spec 00 §3a |
| 2 | **`pdf-parse` v2, not v1** | 04 §3 | npm installs 2.4.5, which removed the `pagerender` callback the spec is written against and returns page-wise text natively as `TextResult.pages[]`. Satisfies the same "boundaries exact, not guessed from form feeds" requirement more directly. `@types/pdf-parse` (v1 types) removed; v2 ships its own. §4 pinned no version. | spec 00 §3a |
| 3 | **`normalise()` de-hyphenates, and ordering is load-bearing** | 01 §4 | A justified PDF yields `corpora-\ntion`; the spec's normalisation makes that `corpora tion`, so the model's verbatim `corporation` fails verification, `is_source_verified` goes false and confidence caps at 49 — presenting a *correct* extraction in the red "verify this" band and distorting the calibration metric. Lowercase next char ⇒ drop hyphen and break; anything else ⇒ drop break, keep hyphen. **Must run before `toLowerCase()`**, or `Non-\nSolicitation` looks like the lowercase case and fuses to `nonsolicitation`. | spec 01 §4 |
| 4 | **`NOT_FOUND` carries a `{noun}` placeholder** | 01 §2 | `PATCH /api/key-terms/{id}` returned "We couldn't find that **contract**." for a missing key term. Parameterising beat adding a code because interpolation is the taxonomy's existing extension mechanism and spec 12 lists `404 NOT_FOUND` as the single not-found code on every route. `ErrorDefinition` gained an optional `defaults` map. | spec 01 §2 |
| 5 | **Classifier regex split into word and stem forms** | 08 §4 | The spec wraps one alternation in `\b(...)\b`. A **trailing** `\b` makes every prefix stem unmatchable: `terminat\b` cannot match "termination", `indemnif\b` cannot match "indemnification", `renew\b` cannot match "renewal". All three stems were dead, so the spec's own §8 example — *"what did you say earlier about indemnity?" → both* — returned `history` and **omitted the document from a question that needed it**. Now `CONTRACT_WORD` (both boundaries) + `CONTRACT_STEM` (leading only), and `indemnif` widened to `indemni`. | spec 08 §4 |
| 6 | **`page_size` above 50 is rejected, not clamped** | 09 §5 | Spec 01 §7's `.max(50)` is normative and rejects; §5's prose said "capped". Silently substituting a different `page_size` would also make the `total`/`page_size` pagination contract dishonest. Returns `400 VALIDATION` with a field map. | spec 09 §5 |
| 7 | **CSP adds `'unsafe-eval'` in development only** | 13 §3 | See §4 below — this one is the most important entry in this document. | spec 13 §3 |
| 8 | **Validation messages appear per touched field, not only on submit** | 03 §6 | See §4 below. | spec 03 §6 |
| 9 | **History signals also match the user's own voice** | 08 §4 | The spec's history regex is written entirely in the second person, so "What have I asked you so far" — §8's own HISTORY example — scored no history signal, classified `contract` and was answered against the document alone. | spec 08 §4 |
| 10 | **Undecidable fallback is `both`, not `contract`** | 08 §4 | "Include the document" is not safe on its own: the `contract` prompt also orders the model to answer only from the document and otherwise reply with the exact refusal, so a classifier miss refuses instead of degrading. No contract signal + an existing conversation ⇒ `both`, which costs nothing since history is sent for every class. | spec 08 §4 |
| 11 | **Class `history` gets its own prompt, not BASE + a suffix** | 08 §5 | BASE orders "answer only from the document … otherwise reply exactly 'I cannot find this in the document.'" while `history` omits the document body. The refusal was the only instruction left to follow, so a correctly classified turn still refused. | spec 08 §5 |
| 12 | **`validateCitations` takes the query class** | 08 §6 | A history answer has no page to cite, so the class-blind check fired a repair call on every correct one — and would have replaced it with a fabricated citation had the repair ever produced a page. | spec 08 §6 |

---

## 3a. Production fixes — what only the live site could show

All three were invisible locally, for the same reason: `next dev` runs unbundled
from `node_modules`, where everything resolves. Netlify's `@netlify/plugin-nextjs`
packages every route into ONE function, `___netlify-server-handler`, and copies
`pdf-parse` as an esbuild external, so anything pdfjs loads **dynamically** is
missing from the function unless pinned. Verified with `netlify build`, which is
the same packaging pipeline as the deploy — inspect
`.netlify/functions-internal/___netlify-server-handler/` after running it.

| Symptom on the live site | Cause | Fix | Commit |
|---|---|---|---|
| Every upload `500 INTERNAL` in ~500 ms: `ReferenceError: DOMMatrix is not defined` | pdfjs 5.4.296 (nested under pdf-parse) evaluates `new DOMMatrix()` at module top level and expects `@napi-rs/canvas` to supply it; the native binary is loaded via a dynamic `createRequire` the trace cannot follow, so it never ships. | Guarded `DOMMatrix` shim in `extract-text.ts` immediately before `import('pdf-parse')`. The legacy build was tried first and is already what loads; it contains the reference. Shipping the ~10 MB canvas binary was rejected — text extraction never calls it. | `490e49e` |
| Upload then `422 CORRUPT_PDF` on a PDF that parses locally | The catch in `extract-text.ts` mapped **every** error to `CorruptPdfError`, so a runtime gap blamed the user's file. | Catch narrowed to pdfjs document exceptions by name (`InvalidPDFException` is what truncated files and non-PDF bytes both raise); everything else surfaces as 500 with the message, first stack frames and userId in the log. That is how the third fault identified itself. | `d9471a2` |
| `/api/health` reported `commit:"dev"` | `COMMIT_REF` is a Netlify **build-time** variable, absent from the function runtime; a `process.env` read at request time cannot work there. `health.test.ts` had passed only because `next dev` compiles and serves in one process. | `scripts/write-build-info.mjs` runs as `prebuild` and writes `src/generated/build-info.ts`; the route imports it. The checked-in default is `"dev"`. `health.test.ts` now asserts the runtime env is **ignored**. | `d9471a2` |
| Upload then `500`: `Setting up fake worker failed: Cannot find module '/var/task/node_modules/pdf-parse/dist/pdf-parse/cjs/pdf.worker.mjs'` | pdf-parse's CJS entry sets `workerSrc ||= "./pdf.worker.mjs"` relative to its own `dist/pdf-parse/cjs/`; dynamic import, untraced, not packaged. | `included_files` on the `[functions]` block in `netlify.toml`. The old `[functions."api/contracts/[id]/process"]` key matched no function and was removed. `standard_fonts/` and `cmaps/` deliberately **not** included: with both hidden the real upload route extracts byte-identical text from a non-embedded Helvetica PDF — they are rendering assets. | `a374533` |

Also in this stretch: the log context is now attached per request, so a 500
carries `userId` (`490e49e`); and the chat double-render was a real bug in
`useChat` (mount-time load applied unconditionally), fixed at the hook level with
a new `tests/hooks/` layer (`d15bc9d`).

Two process errors are on the record and worth knowing about: `490e49e` was
pushed on a red run because Playwright's exit code was masked by a pipe, and
`a374533` swept two generated files into the commit via `git add -A`. Both were
corrected forward (`eac5f4d`, `e63da55`). Gate on exit codes directly; stage
paths explicitly.

---

## 3. Open items

The first four are **reported from live use and not yet reproduced or diagnosed
in this session**; treat the "status" column as the report, not a finding.

| Item | Status | What unblocks it |
|---|---|---|
| **Possible double chat bubble on the live site** | Reported from live use after `d15bc9d`. The hook fix (`useChat` holds a mid-turn history load and merges it after the turn) passed its four hook tests, the full E2E suite with exact-count assertions, and the 10/10 testing-agent run; the live report has not been reproduced. | Reproduce on the live URL with the browser's network tab open: note whether the mount-time `GET /chat` resolves after the `POST`. If it does and a duplicate still renders, the merge in `useChat` is the place to look; if it never does, it is a different mechanism. |
| **BOTH-path "summarize" returns the prior answer verbatim** | Reported from live use. A `both`-class turn ("summarize what you told me") came back as the previous assistant message copied, not a summary. Not reproduced here. The `both` prompt (`BOTH_SUFFIX` in `chat.v1.ts`) permits answering from the conversation; it does not instruct the model to synthesise. | Add the case to `eval/datasets/chat-memory.ts` with an `expectedContains` that a verbatim copy cannot satisfy, run `npm run eval -- --memory-only`, then adjust `BOTH_SUFFIX`. Prompt changes bump `PROMPT_VERSION`. |
| **Notice Period nondeterminism between runs** | Observed across eval runs: the two UK-style MSAs (`msa-03`, `msa-04`) sometimes return the termination notice period as `Notice Period` and sometimes null. The label says absent and was **left as labelled** (recorded in each summary under `known_label_errors`), so the term flips between false positive and true negative run to run. | Decide the label. If a termination notice period *is* a Notice Period, relabel and the nondeterminism becomes a model-consistency question; if not, the term guidance in `term-library.ts` should say so and the prompt evaluated for it. |
| **Localhost redirect URLs missing in Supabase** | Reported: the Supabase Auth redirect allow-list does not include the local origins, so auth flows that return via `/auth/callback` (email confirmation, password reset) cannot land on `localhost` / `127.0.0.1:3000` in development. The E2E suites are unaffected because signup returns a session directly. | Dashboard setting: Authentication → URL Configuration → add `http://localhost:3000/**` and `http://127.0.0.1:3000/**` (and the Playwright port `3200` if the callback is ever exercised in E2E). |
| **`purge-expired-pdfs` pg_cron job unscheduled** | Deliberate. `reclaim-stale-processing` **is** live. | Needs `<PROJECT_REF>` substituted and `select vault.create_secret('<SERVICE_ROLE_KEY>', 'service_role_key');` run by an operator, and the Edge Function deployed. Scheduling early would create a job failing nightly. The 90-day boundary logic is verified in SQL (89 days untouched, 91 purged, `contract_text` preserved). |
| **`next@14.2.5` has a critical advisory chain** | Left pinned, per spec 00 §4 and an explicit instruction. The largest known security debt. | A decision to move to a later 14.2.x. `postcss` also carries a high advisory. `X-Powered-By` is now off, so the version is at least not advertised. |
| **RLS gate runs against the dev project, not a local Supabase** | Accepted. Spec 02 §8 says "local". | `supabase start` + `SUPABASE_DB_URL`. Consequence today: the gate needs network and real credentials, so it is not hermetic. Nothing here runs CI yet. |
| **Chat 30/hour rate limit never exercised live** | Known gap. The same `enforceRateLimit` path is proven on the upload and process buckets. | A dedicated integration file with a small `RATE_LIMIT_CHAT_PER_HOUR` (the harness already sets per-bucket limits via env). |
| **No dark theme** | Spec 16 §4 item 10 and §7 require axe in light **and** dark. No `darkMode` in the Tailwind config, no `dark:` variant in `src/`, nothing in `globals.css`. `accessibility.spec.ts` covers light only and says so. | Someone building it. Emulating `prefers-color-scheme: dark` renders the identical light UI, so a "dark" run would assert nothing. |
| **No tablet tabs** | Spec 16 §2 requires tabbed Document / Terms / Chat at 768–1023px. `ResultsView` has one `lg:` breakpoint; panels stack. `responsive.spec.ts` carries a `test.fixme` so it stays visible in the report. | Someone building it. |
| **`public/demo.gif` does not exist** | Landing page ships without the `DemoGif` section (spec 03 §4). | Someone producing the asset. Omitted rather than shipping a broken image. |
| **Edge Functions never executed** | Both written, neither deployed. | `supabase functions deploy`. `send-notification` degrades safely: with `SMTP_HOST` unset it logs and returns `{sent: 0}`; account deletion treats the send as best-effort. |
| **Calibration unevidenced** | The eval's calibration runner reports 2.9% error under matcher v2 (21.8% under v1), but the corpus produces **one populated bucket** (90–100, n=97) — the model is uniformly confident, so there is no curve. Neither number is a calibration result; spec 17 asks for ten buckets each within ±10%. | A corpus that spreads confidence: SME-annotated real contracts (spec 17 §1), which do not exist yet. The whole eval corpus is synthetic and stamped `provenance: synthetic`; its F1 figures are not the spec 18 §4 launch-gate evidence. |
| **`.env.local` holds 4 of ~50 variables** | Everything else has a working default. | SMTP, Slack webhook and the status-page URL are empty; the features that use them degrade rather than fail. |
| **Export route (spec 15)** | Not built. | v1.1 by the spec's own scoping. |
| **`process.test.ts` `ALREADY_PROCESSING` assertion is flaky** | Pre-existing; not investigated. Fails under full-suite load, passes in isolation. | A timing-tolerant assertion; the check races the first request's completion against the second's arrival. |

---

## 4. Two findings worth reading before you touch the UI

### 4a. The CSP silently disabled ALL client interactivity in development

`next dev` compiles with eval-based source maps and react-refresh. The spec 13 §3
CSP has no `'unsafe-eval'`, so the browser **refused the client bundle entirely**.
Pages rendered from SSR and nothing hydrated: no form, dropzone, dialog, chat
composer or sort header worked. The only symptom is a UI that looks rendered and
does nothing.

It survived seven slices of "verification" because **integration tests call Route
Handlers directly and page assertions were made against SSR HTML** — neither needs
hydration. It was found by a human typing into the signup form, then reproduced
via `page.on('pageerror')` in Playwright.

`next.config.mjs` now adds `'unsafe-eval'` only when `NODE_ENV !== 'production'`;
the production header is byte-identical to the spec table and was asserted before
and after.

> **Rule going forward: any change to the CSP, or to anything client-side, must be
> exercised in a real browser. An HTTP-level assertion cannot see hydration.**

### 4b. The signup submit gate was unreachable-by-design

`disabled={!isValid || isPending}` requires valid email + password ≥ 8 + a letter
+ a digit. All four are satisfiable. But `errors` was only written inside
`handleSubmit`, which only runs from the submit button, which is disabled exactly
when validation fails — so for client-side failures **the error state could never
be reached**. `aria-invalid` stayed false and a disabled button is not focusable,
so there was nothing to explain the dead end (WCAG 3.3.1).

Spec 03 §6's two requirements ("disabled until valid" + "errors inline under the
field") cannot both hold with submit-time validation. Resolved by deriving
messages live per touched field plus a summary line naming the unmet rule.

A third bug was introduced and fixed during that change: `{...liveErrors,
...serverErrors}` let an explicit `undefined` — how a server error is cleared on
the next keystroke — overwrite the live message.

---

## 5. Test harness design

### Layers

| Layer | Location | Command | Count |
|---|---|---|---|
| Unit | `tests/unit/` | `npm run test:unit` | 33 |
| RLS | `tests/rls/` | `npm run test:rls` | 45 |
| Integration | `tests/integration/` | `npm run test:integration` | 76 |
| E2E | `tests/e2e/` | `npx playwright test` | 14 |

Vitest owns `*.test.ts`; Playwright owns `*.spec.ts` (spec 00 §7).

### `OPENAI_BASE_URL` — the model stub
`server-config.ts` gained an optional `OPENAI_BASE_URL`, documented in
`.env.example` as test-only and unset in every real environment. The harness
starts an HTTP server speaking the Chat Completions shape and points the app at
it. **Only the model boundary is faked** — routes, services, Postgres, RLS and
Storage are real. `scriptOpenAi(...)` queues responses (the last repeats);
`openAiRequests()` returns what the app actually sent, which is how the prompt
assembly is asserted.

This is what makes the failure paths testable at zero cost: invalid JSON twice →
`AI_INVALID_OUTPUT` with zero `key_terms`; one bad response → repair retry
rescues it; provider 500 → `status='error'` then retry succeeds without
re-uploading.

### Supabase pass-through proxy — the Storage stub
supabase-js derives `/auth/v1`, `/rest/v1` and `/storage/v1` from **one** base
URL, so Storage cannot be stubbed by swapping a dedicated URL — that would take
auth and the database with it. Instead `startApp({}, { proxySupabase: true })`
starts a transparent proxy that forwards everything to the real project and
fails only the paths given to `failStorageWrites(pattern)`.

**Gotcha it exposed:** supabase-js names its auth cookie
`sb-<first hostname label>-auth-token`, so a proxied app looks for
`sb-127-auth-token`. `projectRef()` derives the cookie from whatever URL the app
is configured with, not from the real project.

### `NEXT_DIST_DIR`
`next.config.mjs` honours `NEXT_DIST_DIR`. Every spawned app compiling into the
same `.next` as a running dev server corrupts the webpack runtime
(`__webpack_modules__[moduleId] is not a function`) — a 500 that looks like an
application fault and is not. Integration builds into `.next-test`, E2E into
`.next-e2e`. **Do not run `npm run build` while a dev server is up** unless you
set this.

### `setPlan(user, plan)`
The free trial allows 5 analyses **in total**, and the counter is deletion-proof
by design, so a suite cannot reclaim units by cleaning up after itself. Any file
uploading more than five contracts must call `setPlan(user, 'pro')`. It also
exercises the `on_plan_change_reset_quota` trigger.

### Per-file rate limits
`startApp(envOverrides)` — the defaults are deliberately generous
(1000/hour) so a suite exercising a route N times doesn't fail for a reason
unrelated to what it tests. `rate-limit.test.ts` starts its own app with **small**
values (3 uploads, 2 processes) to cross the boundary in a few requests, and
asserts something the production numbers make expensive: **a rejected request
still counts**, because the limiter sits at step 2, before validation.

### Cleanup
Every suite destroys its own accounts, **Storage first, then the auth user** —
the DB cascade does not reach `storage.objects`. Verify with:
`select count(*) from auth.users` and
`select count(*) from storage.objects where bucket_id='contracts'`.

---

## 6. The fixture rule

> **Any test that asserts on a contract's key terms must own that state.**

`persist_key_terms` **replaces** a contract's terms — it deletes the existing
rows and inserts the new set (spec 06 §3 step 11), which also clears `is_edited`.
A test relying on a fixture seeded earlier in the file will see it silently wiped
by any other test that processes that contract.

This caused a false failure in the RLS `term_corrections` check: the product was
correct and the test was wrong. Seed or edit inside the test (or its own
`beforeAll`). `processedContract()` in `lifecycle.test.ts` is the pattern —
upload and process a fresh contract per test.

Recorded in spec 02 §8.

---

## 7. E2E and eval — what exists

All nine E2E files are written and green on Chromium + WebKit: `auth`,
`contract-review`, `navigation`, `viewer-fallback`, `chat-history`, `keyboard`
(Chromium only — Safari's Tab skips buttons unless macOS Full Keyboard Access is
on), `accessibility` (axe, light theme only), `responsive` (tablet tabs as
`fixme`), `deletion`, plus `security-headers`. Each file's header states which
of its tests would have passed under the broken CSP, so the coverage claim is
honest about what needs hydration. The OpenAI stub runs as its own Playwright
`webServer` on 3300 (`tests/e2e/openai-stub.mjs`); no spec bills a call.

`tests/hooks/` (Vitest + `@testing-library/react` under jsdom) exists because
the chat double-render lived in an interleaving neither integration nor E2E can
order. Spec 18 §1 records the layer and the reason.

The eval suite (spec 17) is under `eval/`: synthetic datasets with provenance
stamped in every report, eight runners, `npm run eval`, and two preserved
reports for the same model output under matcher v1 (`2026-09-20`) and v2
(`2026-09-20-matcher-v2`). Read `eval/README.md` and `eval/datasets/README.md`
before quoting a number: the corpus is ours, not SME-annotated and not CUAD.

---

## 8. Commands

```bash
npm run dev            # dev server (port 3000)
npm run build          # production build — NOT while dev is running
npm run typecheck
npm run scan:secrets   # CI gate; run after build
npm test               # all vitest layers
npm run test:unit
npm run test:rls       # the PRD Assumption 9 gate
npm run test:integration
npx playwright test    # E2E, Chromium + WebKit
npm run eval           # spec 17 live-model eval (bills ~$1–2); --offline scores the cache
netlify build          # Netlify's own packaging; inspect .netlify/functions-internal/
                       # (folder is linked to contractiqlab; .netlify/ is gitignored)
```
