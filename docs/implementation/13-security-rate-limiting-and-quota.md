# 13 — Security, Rate Limiting, Quota and Concurrency

**Sources:** engineering-doc §6.2 (authorisation, middleware, cross-cutting), §8.5, §12 (secret names), Appendix B; PRD §5 reliability & security, §11 Responsible AI, Assumption 9, A-06, A-13.

---

## 1. Three authorisation layers — none trusted alone

1. **Middleware** (`src/middleware.ts`) — redirects unauthenticated requests for `/dashboard`, `/contracts/*` and `/settings` to `/login?next=…`. UX-level only.
2. **Per-handler** — every Route Handler calls `supabase.auth.getUser()` and adds an **explicit `user_id` ownership predicate** to every query, even though RLS would also enforce it.
3. **PostgreSQL RLS** — the authoritative control. Each Route Handler creates a Supabase client bound to the caller's JWT, so RLS applies to server-side queries too. Storage RLS restricts INSERT/SELECT/DELETE on `storage.objects` to `auth.uid()::text = (storage.foldername(name))[1]`.

### Roles and permissions

There are **no in-app admin or multi-tenant roles at MVP.** Every authenticated user is a single-tenant owner of their own data with full CRUD on their own rows only (`auth.uid() = user_id`). An **anonymous visitor** has read-only access to the static landing and legal pages and **no database read path at all** — `anon` holds no policy on any table. The **Operator / Engineer** is not an in-app role: access is via the Supabase dashboard and the `service_role` key held only in server-side environment variables, never granted to a browser. The **Legal SME** is not an in-app role either: they see only the offline eval dataset plus the audit sample an Operator exports from `feedback_opt_in = true` rows, stripped of identifiers. Team workspaces (v1.2) introduce the first role split and are explicitly deferred.

PRD Assumption 9 is treated as **unproven until tested**: the CI suite attempts cross-user access from two real accounts against every table and Storage (spec 02 §8).

---

## 2. Secret handling

| Secret | Where it lives | Who may use it |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Browser + server | Anyone; RLS constrains it |
| `SUPABASE_SERVICE_ROLE_KEY` | Server env only | **This table is the single authoritative list of service-role call sites** — spec 01 §3 points here, and the CI grep in §9 item 6 is written against it. Exactly six kinds of call site: (1) `DELETE /api/account` (auth-user deletion); (2) the `purge-expired-pdfs` Edge Function; (3) the `send-notification` Edge Function; (4) the `increment_rate_limit` / `acquire_analysis_slot` / `release_analysis_slot` / `consume_analysis_quota` / `refund_analysis_quota` RPCs; (5) **`scripts/notify-incident.ts`** — the operator-run P0 email script, which must bypass RLS to read affected users' `profiles.email` and must authenticate to `send-notification`; (6) the eval/ops scripts an Operator runs locally. **Nothing else.** Sites 5 and 6 are **operator-only Node scripts that are never imported by application code and never bundled**; the CI grep in §9 item 6 is therefore scoped to `src/**` and `supabase/functions/**` and deliberately excludes `scripts/**` and `eval/**`. |
| `OPENAI_API_KEY` | Server env only | `src/lib/ai/openai-client.ts` only |

`src/lib/supabase/admin.ts` and `openai-client.ts` both begin with `import 'server-only'`. A CI step (`npm run scan:secrets`) greps the built client bundle for `SUPABASE_SERVICE_ROLE_KEY`, `OPENAI_API_KEY` and `sk-` and **fails the build on a hit**. The OpenAI key is never sent to, or reachable from, the browser.

---

## 3. Security headers (`next.config.mjs` → `headers()`)

| Header | Value |
|---|---|
| `Content-Security-Policy` | `default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self' https://*.supabase.co; worker-src 'self' blob:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'` |
| `Strict-Transport-Security` | `max-age=63072000; includeSubDomains; preload` |
| `X-Content-Type-Options` | `nosniff` |
| `Referrer-Policy` | `strict-origin-when-cross-origin` |
| `X-Frame-Options` | `DENY` |
| `Permissions-Policy` | `camera=(), microphone=(), geolocation=()` |

`worker-src blob:` is required by the PDF.js worker; `connect-src` includes the Supabase origin for auth, row reads and signed-URL downloads. The OpenAI origin is deliberately **absent** — the browser never talks to OpenAI.

**CRITICAL NOTE (2026-09-20) — this CSP breaks `next dev` and must be
environment-aware.** Next's development server compiles with eval-based source
maps and react-refresh, so `script-src` without `'unsafe-eval'` makes the
browser refuse the client bundle. The page still renders (SSR needs no JS), but
**nothing ever hydrates**: no Client Component becomes interactive, no `useState`
update lands, and every button, form, dropzone, dialog and chat composer is
frozen. The only symptom is a UI that looks rendered and does nothing — it does
not present as a security-header problem.

This shipped undetected through seven slices because API-level tests call Route
Handlers directly and page assertions were made against SSR HTML, neither of
which needs hydration. It surfaced only when a human typed into the sign-up form
and reported the submit button never enabling, and was then reproduced in
Playwright via `page.on('pageerror')`.

`next.config.mjs` therefore adds `'unsafe-eval'` **only when
`process.env.NODE_ENV !== 'production'`**. The production header is byte-identical
to the table above — asserted before and after the change. Any future edit to
this CSP must be exercised through a real browser, not an HTTP client.

---

## 4. Rate limiting (`src/lib/security/rate-limit.ts`)

Postgres-backed fixed-window counters in `rate_limits` — no extra infrastructure, no third-party vendor.

| Bucket | Limit | Routes |
|---|---|---|
| `upload` | 20 / hour / user | `POST /api/contracts/upload` |
| `process` | 10 / hour / user | `POST /api/contracts/{id}/process` |
| `chat` | 30 / hour / user | `POST /api/contracts/{id}/chat` |

```ts
export async function enforceRateLimit(userId: string, bucket: Bucket): Promise<void>;
// calls increment_rate_limit(userId, bucket, limit) via the admin client
// (the function is revoked from public/anon/authenticated and EXPLICITLY
//  granted to service_role — the blanket revoke strips the grant it would
//  otherwise inherit, so without that grant its only caller could not call it);
// when the returned count exceeds the limit, throws
// appError('RATE_LIMITED', { minutes }) with details.retryAfterSeconds =
// seconds remaining in the current hour window.
```

`429` responses always carry `Retry-After`. The window is the truncated hour, so counters reset on the hour. Rows older than 7 days are pruned by the nightly job.

Clients cannot read or reset their counters: `rate_limits` has RLS enabled with **no policies**, and `EXECUTE` on `increment_rate_limit` is revoked from `anon` and `authenticated`.

---

## 5. Plan quota (`src/lib/security/quota.ts`) — enforcement without billing

There is **no payment provider at MVP (A-06)**. `profiles.plan` is operator-set from the Supabase dashboard. The quota layer is provider-agnostic, so adding a payment provider later touches only `profiles` and a webhook route.

| Plan | Allowance | Window |
|---|---|---|
| `free_trial` | **5 analyses total** | Within the 14 days ending at `trial_ends_at` |
| `starter` | 10 / month | Calendar month |
| `growth` | 40 / month | Calendar month |
| `pro` | Unlimited | — |

**Expired free trial.** Neither source document says what happens when
`trial_ends_at` passes without an operator setting a plan. The rule here is a
single unambiguous one: a `free_trial` profile whose `trial_ends_at` is in the
past has a limit of **0** and every upload is rejected with
`QUOTA_EXCEEDED`, message **"Your free trial has ended — email
support@contractiq.app to choose a plan."** (a distinct string from the
in-trial/paid-plan message, so no `{limit}`/`{plan}` interpolation is needed).
The plan value itself is *not* mutated — only an operator changes `profiles.plan`.
Recorded as an open product item in spec 19 §P.

```ts
export async function assertQuota(userId: string): Promise<QuotaState>;
// plan='free_trial' && trial_ends_at > now()  -> limit = QUOTA_FREE_TRIAL_TOTAL (5), window = trial
// plan='free_trial' && trial_ends_at <= now() -> limit = 0, throw QUOTA_EXCEEDED (trial-ended copy)
// plan='starter'|'growth'                     -> limit = 10 | 40, window = calendar month
// plan='pro'                                  -> unlimited
```

**Counting is deletion-proof.** The counter is **not** a live `COUNT(*)` over `contracts`: PRD §5 guarantees a user may delete any contract at any time, which would otherwise refund quota and make the PRD §12 caps trivially bypassable. Instead `profiles.analyses_used` + `profiles.quota_period_start` are incremented atomically by `consume_analysis_quota(user_id, period_start)` (`supabase-schema.sql` §12a), which rolls the period when `quota_period_start` is older than the current one. The counter is **monotonic within a period and never decremented on contract deletion**.

**When a unit is consumed:** at **upload**, immediately after all file validation passes and immediately before the `contracts` insert — the point at which the analysis is committed. Rules:
- If `consume_analysis_quota` returns a count **above** the plan limit, the handler calls `refund_analysis_quota` and returns `402 QUOTA_EXCEEDED`; the row is never created.
- If any later step of the upload fails (DB insert error), the handler calls `refund_analysis_quota` in its catch — the user is not charged for a contract that does not exist.
- A **retry of a failed extraction consumes nothing** (the unit was taken at upload, and `/process` never touches the counter), which matches "retry without re-uploading".
- An uploaded-but-never-processed contract **does** consume its unit — the quota reserves capacity, and re-uploading the same file would consume another.
- `free_trial` uses `period_start = profiles.created_at` so the 5 analyses are a total across the trial, not per month; paid plans use `date_trunc('month', now())`.
- **A plan change resets the allowance immediately.** The `on_plan_change_reset_quota` trigger (`supabase-schema.sql` §12a) sets `analyses_used = 0` and a fresh `quota_period_start` whenever `profiles.plan` changes. Without it, a user created mid-month whose `quota_period_start` is their `created_at` would not roll when moved to `starter` (because `date_trunc('month', now())` is *earlier* than `created_at`) and would carry their trial usage into the first paid month — receiving fewer than the 10/month the PRD promises. Since plan changes are operator-set (A-06), the trigger is the only place this needs to happen.

`QuotaState { plan, used, limit, remaining, resetsAt }` is read from the same two columns and is what `/settings` renders.

**Feature gating by plan** is limited to export (A-16): Free Trial, Growth and Pro may export; a Starter user whose trial has ended gets `403 PLAN_REQUIRED`. No other feature is plan-gated — chat, custom terms, the viewer and correction are available on every plan.

---

## 6. Concurrency guard (`src/lib/security/concurrency.ts`, A-13)

A Postgres-backed semaphore caps **in-flight analyses at 100** (the PRD's beta concurrency target), using the `analysis_slots` table and its two `SECURITY DEFINER` functions from `supabase-schema.sql`.

```ts
export async function withAnalysisSlot<T>(fn: () => Promise<T>): Promise<T>;
// 1. holder = crypto.randomUUID() for this request.
// 2. slot = await admin.rpc('acquire_analysis_slot', { p_holder: holder })
//    -> the SQL function claims one of the 100 seeded `analysis_slots` rows
//       with FOR UPDATE SKIP LOCKED, or returns NULL when all are busy.
// 3. NULL -> retry every 250 ms for up to 5 s (graceful queuing), then throw
//    appError('CAPACITY') -> 503 "We're handling a lot of contracts right now.
//    Try again in a minute."
// 4. finally -> admin.rpc('release_analysis_slot', { p_slot: slot, p_holder: holder }),
//    ALWAYS, including on throw/timeout.
```

**Why a counter table rather than `pg_try_advisory_lock`:** advisory locks are
*session*-scoped, and Supabase/PostgREST pools connections, so the session that
took a lock is not guaranteed to be the one that releases it — a slot could leak
or be freed by an unrelated request. `analysis_slots` with `FOR UPDATE SKIP
LOCKED` is transaction-scoped, pool-safe, and self-healing: `acquire_analysis_slot`
also reclaims any slot whose `acquired_at` is older than **2 minutes**, which is
longer than the worst-case process run (20 s × 3 attempts + repair + persist), so
a crashed request cannot hold a slot forever. Both functions are `SECURITY
DEFINER`, revoked from `anon`/`authenticated` and granted to `service_role` only,
and the table has RLS enabled with no policies.

Queuing rather than degrading is the point: 100 concurrent analyses must run without latency degradation, and the 101st gets an honest message instead of a slow response for everyone.

---

## 7. Input handling

- Every payload is parsed by its shared zod schema before use; failures return `400` with a field map.
- Sort/order/status/type query values pass through allow-lists — never string-interpolated into a query.
- Uploaded filenames are sanitised before becoming a Storage path (spec 02 §6); the original is stored only as display text and is escaped by React on render.
- Model output is validated by `keyTermSchema` before anything is written; invalid items are dropped and counted, never persisted.
- Chat and term values are rendered as plain text (no `dangerouslySetInnerHTML` anywhere in the codebase).
- **Prompt-injection posture:** contract text is untrusted input. The system prompt is always first, the document is passed as a separate context block clearly labelled as the user's document, and the model has **no tools and no actions** — it can only return text (PRD §4: "AI cannot take actions on the contract"). Extraction output is schema-validated and source-verified against the document, so an injected instruction cannot produce an unverifiable term that renders as high confidence.

---

## 8. Logging and privacy

Structured JSON per request: `{ requestId, userId, route, method, status, durationMs, outcome, errorCode? }`. **Contract text, term values and chat content are never logged**, never placed in `activity_events.metadata`, and never sent to any third party other than OpenAI as the inference input. OpenAI calls send `user: <supabase_user_id>` for abuse tracing with **training opt-in disabled**.

---

## 9. Security audit checklist (v1.0 launch gate)

1. RLS cross-account suite green for every table and Storage.
2. Client-bundle secret scan green.
3. Signed URLs expire at 1 hour (integration-asserted).
4. All traffic HTTPS with HSTS; data encrypted at rest (AES-256, Supabase default) and in transit (TLS 1.3).
5. `rate_limits` unreachable from any client.
6. No `service_role` usage outside the sanctioned call sites listed in §2 — grep-asserted in CI over `src/**` and `supabase/functions/**` only, since operator scripts under `scripts/**` and `eval/**` are sanctioned site (5)/(6) and are never bundled.
7. Pre-launch penetration review attempting cross-user data access from a second real account.
8. CSP verified with no violations in the browser console across every route.

---

## 10. Tests

- `tests/integration/rate-limit.test.ts` — the 21st upload, 11th process and 31st chat message in an hour each return `429` with `Retry-After`; the counter resets on the hour boundary.
- `tests/integration/quota.test.ts` — **delete-then-re-upload does not restore quota** (the decisive case); a `free_trial` user who used 4 analyses and is moved to `starter` mid-month gets the full 10 that month (`analyses_used` reset to 0 by the trigger); a failed upload after the counter moved is refunded, leaving `analyses_used` unchanged; a retry of a failed extraction consumes nothing; the period roll resets the counter on the 1st of the month; a `free_trial` user is blocked at the 6th analysis; an **expired** trial is blocked at the 1st with the trial-ended message and `profiles.plan` is left unchanged; `starter` at 11; `growth` at 41; `pro` is never blocked.
- `tests/integration/concurrency.test.ts` — 100 simulated slots held, the 101st request returns `503 CAPACITY`; slots are released after a thrown handler.
- `tests/rls/*` — the full matrix in spec 02 §8.
- `tests/unit/headers.test.ts` — every header above is present with the exact value.
- k6: 100 concurrent analyses sustained without error-rate or latency degradation; a headroom run at 1,000 concurrent users.
