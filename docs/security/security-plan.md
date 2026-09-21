# Security plan

**Audit date:** 2026-09-20
**Lens:** `skills/security-foundation/SKILL.md`
**Scope:** the shipped Stage 5 codebase, not a greenfield build.

The skill is written for Stage 3 — *before* feature development, generating
controls from scratch. This codebase is at Stage 5 with spec 13 controls already
built and tested. So this was run as an **audit against the skill's requirement
list**, fixing what was genuinely missing or wrong and reconciling the rest.
Regenerating the skill's file layout verbatim would have duplicated working,
tested code and, in several places, weakened it — see *Reconciliation* below.

---

## 1. Issues found and fixed

| # | Severity | Issue | Fix |
|---|---|---|---|
| 1 | **High** | **No prompt-injection screening on chat input.** User messages went straight to GPT-4o. The existing posture was architectural only (system prompt first, contract body labelled as data). Skill §4 requires an input-side control. | `src/lib/security/prompt-injection.ts` + screening in the chat route before the session is touched and before any model call. Returns `400 PROMPT_INJECTION`. |
| 2 | **Medium** | **Open redirect via `?next=`.** `safeNextPath` checked for a literal `//` but browsers normalise `\` to `/`, so `/\evil.com` navigated cross-origin. A phishing link could go through the real login page and bounce the user to an attacker's site *after* a genuine sign-in — the most credible version of this attack. Control characters had the same effect: `/\t/evil.com`. | Backslashes normalised before the check; control characters rejected. |
| 3 | **Low** | **Forged `[PAGE N]` markers in contract text.** `[PAGE N]` is load-bearing — the prompts, the citation validator and `page-utils` all trust it for attribution. Contract bodies are attacker-controlled, so a PDF containing a literal `[PAGE 99]` line could move a citation to a page the text is not on. Honesty failure in a product whose core claim is page traceability. | `sanitiseForLlm()` applied in `extract-text.ts` to each raw page body **before** the genuine markers are inserted. See the note below on getting this wrong first. |
| 4 | **Low** | **Custom term names reach the extraction *system* prompt** — the highest-trust position in the request — with only a length bound. | `sanitiseCustomTermName()` strips newlines and leading list/heading markers. |

### On fixing finding 3 at the wrong layer first

The marker defence was applied first in `buildExtractionUserMessage`, which
sanitised the contract text on its way to the model. That was wrong, and an
existing test caught it immediately: by that point the genuine markers and a
forgery are **identical strings**, so the fix destroyed the real page
attribution the extraction depends on — a silent correctness bug in the core
feature, introduced by a security change.

The two are only distinguishable at the moment the real markers are inserted,
in `extract-text.ts`, which is where the sanitising now happens. The forged
text is defanged, not removed: a hostile clause inside a contract is exactly
what a reviewer needs to see, so it stays readable.

### On the false positive that nearly shipped

The first version of the injection guard blocked *"Does clause 7 override the
previous agreement instructions?"* — an ordinary contract question. Legal prose
is saturated with the vocabulary a naive filter keys on: "override",
"instructions", "act as", "notwithstanding the previous". A filter that blocks
the product's actual job has cost real usability for no security gain, because
the model has no tools, no write path, and the route never executes its output.

Every pattern therefore requires an imperative **addressed to the assistant**,
anchored to the start of a message or clause. It was caught by an integration
test written for exactly that risk, and that test stays.

---

## 2. Audited and already correct — no change

| Skill § | Requirement | What was found |
|---|---|---|
| §1 | Auth + protected routes | `src/middleware.ts` guards `/dashboard`, `/contracts`, `/settings`; authed users bounce off `/login` and `/signup`. Layer 1 of 3 — every Route Handler re-checks the session and RLS is authoritative. 14 of 15 API routes call `getUser()`; `/api/health` is public by design and exposes no user data. |
| §2 | Zod validation on every route | Seven schemas in `src/lib/validation/`. Query params use strict enum allow-lists, so no client string reaches the query builder. |
| §3 | Rate limiting | `src/lib/security/rate-limit.ts`, sliding window, reads and writes via `createAdminSupabaseClient()` so users cannot manipulate their own counts. `rate_limits` is service-role only. |
| §5 | Token and usage limits | 10 MB upload, 20 pages, 15,000 tokens, 2,000-character messages, capped chat history — all enforced server-side. |
| §6 | Chat security | Contract ownership checked with `.eq('user_id', user.id)` on both GET and POST; `409 NOT_PROCESSED` unless `status='completed'`. |
| §7 | File upload security | **Magic-byte validation** (`%PDF-`), not the declared MIME type. Size → magic bytes → pages → tokens. Filenames sanitised to `[A-Za-z0-9._-]`, so no path traversal. Private bucket, 1-hour signed URLs, no public URLs. |
| §8 | Environment variables | `OPENAI_API_KEY` and `SUPABASE_SERVICE_ROLE_KEY` are server-only; the admin client is `import 'server-only'`. `npm run scan:secrets` is a CI gate over the built client bundle. No secret logging. |
| — | RLS | 15 tables, RLS on all of them, 37 policies, every one scoped to `user_id = auth.uid()`. Proven by the cross-account RLS suite. |
| — | Headers | CSP with `frame-ancestors 'none'`, HSTS preload, `nosniff`, `Referrer-Policy`, `X-Frame-Options: DENY`, `Permissions-Policy`. Pinned by `tests/e2e/security-headers.spec.ts`; see §8 for the two header decisions. |
| — | Error handling | Users only ever see taxonomy copy; stacks stay server-side. No `dangerouslySetInnerHTML` anywhere. |

---

## 3. Reconciliation — where the skill was not followed, and why

The skill is a Stage 3 template. Applying these points literally to the shipped
app would have regressed it. Each was a deliberate decision, not an oversight.

| Skill says | Shipped | Why the shipped behaviour stands |
|---|---|---|
| Chat 30/min, auth 10/min, process 5/hr, upload 20/day | Chat 30/**hr**, process 10/hr, upload 20/hr | Spec 13 §2 is the normative source and is **stricter** on chat by a factor of 60. Loosening a shipped limit is not a security fix. |
| `422 VALIDATION_ERROR` | `400 VALIDATION` | Spec 12 lists `400` on every route and the 27-code taxonomy is asserted by the integration suite. Renumbering would break the documented API contract. |
| Allow `.pdf` **and** `.docx` | `.pdf` only | The product is PDF-only by spec; the whole extraction path assumes it. Accepting `.docx` would widen the attack surface *and* break processing. |
| Max 200 pages | 20 pages | Spec 04. The app is ten times stricter. |
| New `rate_limit_events` table | Existing `rate_limits` | Same sliding-window design, already live with RLS and an index. A second table would fragment enforcement. |
| `lib/security/authGuard.ts`, `chatSecurity.ts`, `inputValidator.ts`, `tokenLimiter.ts` | Inline `getUser()` + ownership filters, `src/lib/validation/*`, `src/lib/utils/server-config.ts` | The controls exist and are tested. Re-homing them behind new wrappers is churn on audited code, and every route would need re-verifying to gain nothing. |
| `app/api/auth/login` + `logout` routes | Client `supabase.auth` + `updateSession` middleware | The `@supabase/ssr` client already sets cookies correctly through the middleware; signup/login/logout round trips are covered by `auth.spec.ts` on two engines. Replacing a working, tested auth path carries more risk than it removes. |
| camelCase filenames | kebab-case | Matches every other file in `src/lib/`. |

---

## 4. Files created and modified

**Created**
- `src/lib/security/prompt-injection.ts`
- `tests/unit/security.test.ts` (11 tests)
- `docs/security/security-plan.md`

**Modified**
- `src/components/auth/auth-validation.ts` — open redirect fix
- `src/app/api/contracts/[id]/chat/route.ts` — screening before the model call
- `src/lib/ai/prompts/extraction.v1.ts` — marker and custom-term sanitising
- `src/lib/errors/error-codes.ts` — `PROMPT_INJECTION` (code 28)
- `src/lib/metrics/events.ts` — `prompt_injection_blocked`
- `tests/integration/chat.test.ts` — 3 route-level tests

---

## 5. SQL to run

**None.** No schema change. `activity_events.event_type` is a free-text column
with no CHECK constraint, so the new event type needs no migration, and
`rate_limits` already exists with RLS enabled.

## 6. Environment variables to add

**None.** No new configuration. `MAX_CHAT_HISTORY` in the skill maps to the
existing `MAX_CHAT_HISTORY_MESSAGES`, already in `server-config.ts` with a
default.

---

## 7. Outstanding

| Item | Note |
|---|---|
| Supabase dashboard settings | Email verification, password reset, session management and refresh-token rotation (skill §1) are **dashboard** settings that cannot be asserted from the codebase. An operator must confirm them. |
| CSRF | Not separately implemented. Supabase SSR cookies are `SameSite=Lax`, which blocks cross-site `POST`, and every state-changing route is `POST`/`PATCH`/`DELETE` with a JSON body. Worth a deliberate decision before public launch rather than relying on the default. |
| Injection guard coverage | Pattern-based, so it is a speed bump and not a boundary. The real control remains architectural: no tools, no write path, output never executed. Revisit if the assistant ever gains an action. |
| `next@14.2.5` advisory chain | Unchanged from the Stage 5 handoff — still pinned, still carrying a critical advisory. Out of scope here, but it is the largest known security debt in the project. |

---

## 8. Response header decisions

Both of these came out of a manual header check against a running server, not
out of the audit — which is itself the finding: **the headers had no test at
all.** The production CSP was verified by hand during Stage 4 and never pinned,
so nothing would have caught a regression. `tests/e2e/security-headers.spec.ts`
now asserts every header against a real server, and the `X-Powered-By` case was
mutation-checked to confirm it fails when the setting is removed.

### `X-Powered-By` — now disabled

**Was being sent.** Next sets `X-Powered-By: Next.js` by default, and
`poweredByHeader: false` was missing from `next.config.mjs`.

It is free version disclosure: it tells a scanner which framework to look up
advisories for, and this app is pinned to `next@14.2.5`, which carries a known
critical advisory chain (see §7). Low severity on its own, but there is no
argument for sending it — nothing depends on the header.

### `X-XSS-Protection` — deliberately absent, do not add it

**To be straight about the provenance: this was not a decision I made during
the audit.** Spec 13 §3 omits the header, the audit checked the headers that
are present rather than enumerating ones that are not, and I did not flag it.

Having now looked at it deliberately: **omitting it is correct, and it should
not be added.**

- **It is deprecated and inert.** Chrome removed the XSS Auditor in v78, Edge
  dropped it when it moved to Chromium, and Firefox never shipped it. On any
  current browser the header does nothing at all.
- **Where it still acts, it has been harmful.** The auditor's filtering was
  itself exploitable — it could be induced to block legitimate script, and to
  leak cross-origin information through its own behaviour. `1; mode=block` is
  now understood as a liability rather than a control, which is why OWASP's
  guidance is to omit the header or send `0` and rely on CSP.
- **The actual control is already there.** The CSP in §3 is what constrains
  script execution, and it is asserted.

A checklist that lists `X-XSS-Protection` is describing 2016. If a reader adds
it back as a "fix", `tests/e2e/security-headers.spec.ts` fails and points at
this section.

