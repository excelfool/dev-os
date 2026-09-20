# Handoff — end of Stage 5 (partial)

**Date:** 2026-09-20
**State:** Stage 4 (Feature Implementation) complete. Stage 5 (Testing) partially
complete — unit, RLS and integration layers done; E2E started, one file of five.
**Verification at handoff:** `npm test` → **154 passing** (10 files).
`npx playwright test` → **14 passing** (Chromium + WebKit).
`npm run build` clean, `npm run scan:secrets` clean, `npx tsc --noEmit` clean.
Database left at zero rows, zero storage objects.

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
The 10 NDA / 12 MSA library, `openai-client.ts` with deadline-aware retries,
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

## 3. Open items

| Item | Status | What unblocks it |
|---|---|---|
| **`purge-expired-pdfs` pg_cron job unscheduled** | Deliberate. `reclaim-stale-processing` **is** live. | Needs `<PROJECT_REF>` substituted and `select vault.create_secret('<SERVICE_ROLE_KEY>', 'service_role_key');` run by an operator, and the Edge Function deployed. Scheduling early would create a job failing nightly. The 90-day boundary logic is verified by exercising the function's exact query/update in SQL (89 days untouched, 91 purged, `contract_text` preserved). |
| **`next@14.2.5` has a critical advisory chain** | Left pinned, per spec 00 §4 and an explicit instruction. | A decision to move to a later 14.2.x. `postcss` also carries a high advisory. |
| **RLS gate runs against the dev project, not a local Supabase** | Accepted. Spec 02 §8 says "local". | `supabase start` + `SUPABASE_DB_URL`. Consequence today: the gate needs network and real credentials, so it is not hermetic. Nothing here runs CI yet. |
| **Chat 30/hour rate limit never exercised live** | Known gap. | Would need 24 more billed turns (~$0.08) against the real API, or a dedicated integration file with a small `RATE_LIMIT_CHAT_PER_HOUR` — the latter is cheap and is the recommended route. The same `enforceRateLimit` code path is proven on the upload and process buckets. |
| **`public/demo.gif` does not exist** | Landing page ships without the `DemoGif` section (spec 03 §4). | Someone producing the asset. Omitted rather than shipping a broken image. |
| **Edge Functions never executed** | Both written, neither deployed. | `supabase functions deploy`. `send-notification` degrades safely today: with `SMTP_HOST` unset it logs and returns `{sent: 0}` rather than throwing, and account deletion treats the send as best-effort. |
| **`.env.local` holds 4 of ~50 variables** | Everything else has a working default. | SMTP, Slack webhook and the status-page URL are empty; the features that use them degrade rather than fail. |
| **Export route (spec 15)** | Not built. | v1.1 by the spec's own scoping. |
| **No tablet tabs** | Spec 16 §2 requires a tabbed Document / Terms / Chat layout between 768px and 1023px. `ResultsView` has one `lg:grid-cols-[58fr_42fr]` and nothing else, so at tablet width the panels simply stack. There are no tabs in the codebase. | Someone building it. `responsive.spec.ts` carries a `test.fixme` for it, so it stays visible in the report rather than being absent from it. |
| **No dark theme** | Spec 16 §4 item 10 and §7 require axe in light **and** dark. There is no dark theme: no `darkMode` in the Tailwind config, no `dark:` variant anywhere in `src/`, nothing in `globals.css`. | Someone building it. `accessibility.spec.ts` covers light only and says so — emulating `prefers-color-scheme: dark` renders the identical light UI, so a "dark" run would assert nothing while reporting coverage. |
| **`process.test.ts` `ALREADY_PROCESSING` assertion is flaky** | Pre-existing; not investigated. Fails under full-suite load, passes in isolation (18/18). Untouched by the chat work. | A timing-tolerant assertion. The check races the first request's completion against the second request's arrival. |

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

## 7. E2E tests remaining

`tests/e2e/auth.spec.ts` exists (14 tests, Chromium + WebKit): the signup gate
including the reported 13-character-password case, per-rule messages,
`aria-invalid`, keyboard-only operation, signup round trip under the 10s budget,
no field disclosure on bad credentials, and `?next=` returning to the originally
requested page.

Still to write, in rough priority order:

1. **`contract-review.spec.ts`** — the full journey: upload → prepare (term
   preview, add a custom term, see its "Custom" badge) → process → results
   (values, page chips, confidence badges) → inline edit → "Edited" badge → mark
   review complete → dashboard badge updates. Spec 04 §7, 05 §6, 07 §8, 10 §6.
   **The OpenAI stub is now reachable from the Playwright server** —
   `tests/e2e/openai-stub.mjs` runs as its own `webServer` entry on port 3300
   and the app is started with `OPENAI_BASE_URL` pointed at it. Spec files
   script it and read its request log over `/__control/*`. No billed calls.
2. **`navigation.spec.ts`** — clicking a page chip scrolls the viewer to that
   page and flashes the highlight, **in both viewers**. Spec 07 §8.
3. **`viewer-fallback.spec.ts`** — with Storage unavailable, the results page
   renders the text viewer and all terms. The Supabase proxy from §5 makes this
   drivable; wire it into the Playwright `webServer`.
4. ~~**`chat-history.spec.ts`**~~ — **written 2026-09-20** (6 tests, Chromium +
   WebKit), covering the two turns that failed live in Lab 2 Lesson 2. Still
   owed from this file: the citation chip actually navigating the viewer, which
   belongs with `navigation.spec.ts`.
5. **`keyboard.spec.ts`** — the entire core flow completed with the keyboard
   only. Spec 16 §7.
6. **`accessibility.spec.ts`** — axe-core via `@axe-core/playwright` on every
   route and both viewers, failing on any serious/critical violation. Spec 16 §4
   item 10. **Not yet installed.**
7. **`responsive.spec.ts`** — tablet tabs and the mobile bottom-sheet chat.
8. **`deletion.spec.ts`** — delete from the dashboard removes the row and shows
   the toast; the results page for that id then 404s. Spec 11 §5.

After E2E, Stage 5 also still owes the **eval suite** (spec 17) — datasets,
8 runners, report schema — which is a separate body of work from the test layers
and is what the F1 and calibration launch gates in spec 18 §4 depend on.

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
```
