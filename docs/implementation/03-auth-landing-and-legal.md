# 03 — Auth, Session, Landing Page and Legal Pages

**Requirements:** US-001, FR-01; PRD §4 Flow 1 and Flow 2; engineering-doc §4.1, §4.2, §5.2, §6.2 (auth/authorisation), §10 v0.1.
**Acceptance:** auth flow completes ≤ 10 s; success redirects to `/dashboard`; invalid credentials show a clear error; a `profiles` row is created by trigger.

---

## 1. Supabase Auth configuration

Email/password provider only. No OAuth at MVP. **"Confirm email" = OFF** (A-05). Session JWTs are stored in HTTP-only, `Secure`, `SameSite=Lax` cookies managed by `@supabase/ssr`. Redirect allow-list must include `${NEXT_PUBLIC_SITE_URL}/auth/callback`.

Both confirmation paths are implemented, so flipping the Supabase toggle changes behaviour with no code change:

- **OFF (default):** `signUp` returns a session immediately → route straight to `/dashboard`.
- **ON:** `signUp` returns no session → render "Check your inbox to verify your email"; the emailed link hits `/auth/callback?code=…`, which exchanges the code and redirects to `/dashboard`.

The client decides which copy to show from `publicConfig.emailConfirmationEnabled`, but the **authoritative** signal is whether `data.session` is present in the `signUp` response — always branch on that, never on the flag alone.

---

## 2. Routes

| Route | Rendering | Auth | Notes |
|---|---|---|---|
| `/` | Static Server Component | Public | Landing; no data fetch, cached at the CDN, renders < 1 s with no auth round-trip |
| `/signup` | Client Component | Public — redirect to `/dashboard` if a session exists | Email + password |
| `/login` | Client Component | Same | Email + password, honours `?next=` |
| `/auth/callback` | Route Handler | Public | `exchangeCodeForSession(code)` then redirect. File: `src/app/(auth)/auth/callback/route.ts` — the route group contributes no path segment, so the literal `auth` segment must be in the tree or the verification link 404s |
| `/legal/terms`, `/legal/privacy` | Static | Public | ToS and privacy/DPA notice |
| `/dashboard`, `/contracts/*`, `/settings` | Protected | Session required | See spec 09 / 04 / 11 |

---

## 3. `src/middleware.ts`

```ts
export const config = {
  matcher: [
    // Everything except static assets AND the two public API routes.
    // /api/health must stay reachable unauthenticated: Uptime Robot polls it
    // every minute and it is the evidence for the 99.5% uptime SLA. It must not
    // pass through updateSession (a cookie refresh on an anonymous poll is
    // wasted work and could turn a DB blip into a 500 on the health check).
    // /api/system-status is excluded only to skip a wasted cookie refresh on a
    // 60-second poll. It is NOT public: the handler re-checks the session and
    // system_status has a SELECT policy for `authenticated` only (spec 12 row 18,
    // engineering-doc §7.13). An anonymous caller gets 401 from the handler.
    '/((?!api/health|api/system-status|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
};
```

An unauthenticated `GET /api/health` therefore never enters the middleware, is never redirected, and returns `200`/`503` purely on the DB check (spec 14 §1).

Behaviour, in order:
1. Call `updateSession(request)` from `src/lib/supabase/middleware.ts` — refreshes the auth cookie on **every** matched request so a long review session never expires mid-flow.
2. If the path starts with `/dashboard`, `/contracts` or `/settings` **and** there is no user → `307` redirect to `/login?next=<encoded original path+query>`.
3. If the path is `/login` or `/signup` **and** a user exists → `307` redirect to `/dashboard`.
4. Otherwise continue.

Middleware protection is **UX-level only**. Every Route Handler independently re-checks the session, and RLS is the third and final gate. Neither of the first two layers is trusted alone.

---

## 4. Landing page `/` (engineering-doc §10 v0.1)

Server Component, zero client JS beyond the nav. Sections:

1. **Hero** — headline "Understand any NDA or MSA in under 15 minutes", sub-line naming the outcome (key terms, page references, confidence scores, plain-English chat), and two CTAs: **"Get Started Free"** → `/signup` (primary) and **"Sign In"** → `/login` (secondary).
2. **DemoGif** — `public/demo.gif` rendered with `next/image` (`unoptimized`), `width`/`height` set to avoid layout shift, `alt="Uploading a contract and seeing key terms extracted with page numbers and confidence scores"`. A static poster frame is shown when `prefers-reduced-motion: reduce`.
3. **FeatureGrid** — four cards mirroring the MOAT: contract-type-specific term library (10 NDA / 12 MSA terms), page-level attribution, confidence score per term, chat grounded in your document only.
4. **Footer** — "Powered by OpenAI GPT-4o" attribution (required on every page, PRD §11 Transparency), links to `/legal/terms` and `/legal/privacy`, and the "Service status" link from `publicConfig.statusPageUrl` (spec 14 §2b).

Acceptance: Lighthouse performance ≥ 90; no dynamic content; no Supabase call.

---

## 5. Legal pages

`/legal/terms` must state the misuse prohibition verbatim in substance: use of third-party confidential contracts without permission is prohibited (PRD §11 Transparency — indirect misuse mitigation). It must also carry the not-legal-advice statement.

`/legal/privacy` must state: contracts are stored encrypted at rest (AES-256) and transferred over TLS 1.3; PDFs are retained for 90 days after last access then auto-deleted; extracted text and key terms are retained as the review record until the user deletes them; no contract content is used to train any model, by ContractIQ or by OpenAI; the OpenAI `user` parameter is sent for abuse tracing; users may delete any contract or their entire account at any time; Article 28 DPAs with Supabase and OpenAI are in place before EU onboarding.

---

## 6. Sign-up screen `/signup`

**Component:** `AuthCard → AuthForm → FieldError` (`src/components/auth/`).

Fields and client validation (zod, shared with nothing server-side because Supabase Auth is called directly from the browser):
- `email` — `z.string().email()`; message "Enter a valid email address."
- `password` — `z.string().min(8).regex(/[A-Za-z]/).regex(/[0-9]/)`; message "Use at least 8 characters, including a letter and a number."

Behaviour:
- Submit is **disabled until the form is valid**; on submit the button enters a loading state with the accessible label "Creating your account…".
- **Validation messages appear per field once that field is touched, NOT only after a submit.** These two requirements are in tension as originally written: with submit disabled while invalid, a handler that sets error state on submit can never run, so a client-side validation failure produced a disabled button and no stated reason — and `aria-invalid` stayed `false`, leaving assistive tech nothing (WCAG 3.3.1 Error Identification). The form derives messages live from the schema result per touched field, and renders a summary line naming the unmet rule, because a disabled button is not focusable and cannot carry the explanation itself.
- `supabase.auth.signUp({ email, password })` from the browser client.
- `data.session` present → `recordEvent('auth_complete', durationMs)` then `router.replace('/dashboard')`.
- `data.session` absent → render "Check your inbox to verify your email" with a "Resend email" link (calls `signUp` again, disabled for 60 s after each press).
- Errors, mapped to inline copy under the relevant field:
  - already-registered email → "That email is already registered — try signing in instead." with a link to `/login`.
  - weak password rejected server-side → the password rule message above.
  - network/unknown → "We couldn't create your account. Please try again."
- On success the `on_auth_user_created` trigger has already inserted the `profiles` row (`plan='free_trial'`, `trial_ends_at = now() + 14 days`). The app never inserts profiles from client code.

---

## 7. Sign-in screen `/login`

Same card. `supabase.auth.signInWithPassword({ email, password })`.
- Success → redirect to `?next=` if it is a **relative** path beginning with `/` (open-redirect guard), else `/dashboard`.
- Invalid credentials → a single form-level error, "Email or password is incorrect." Never disclose which field was wrong.
- Rate-limited by Supabase → "Too many attempts. Try again in a few minutes."
- **No password-reset flow at MVP.** FR-01 and US-001 scope auth to sign up, sign in and sign out, and neither source document specifies a reset or password-update surface. A user who forgets their password is handled by an operator via the Supabase dashboard. Adding self-service reset requires a `/auth/reset` request screen and a `/auth/update-password` screen behind the recovery session — recorded as an open product item in spec 19 §P.

---

## 8. `/auth/callback` Route Handler

```ts
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  const next = searchParams.get('next');
  const safeNext = next?.startsWith('/') ? next : '/dashboard';
  if (!code) return NextResponse.redirect(`${origin}/login?error=missing_code`);
  const supabase = createServerSupabaseClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) return NextResponse.redirect(`${origin}/login?error=verification_failed`);
  return NextResponse.redirect(`${origin}${safeNext}`);
}
```

`/login` renders "That verification link is invalid or has expired — try signing in or requesting a new link." for `error=verification_failed`.

---

## 9. Sign-out

In the authed shell's user menu (`src/components/layout/Navbar.tsx`): `await supabase.auth.signOut()` on the browser client, then `router.replace('/')` and `router.refresh()` so the server cookie is cleared and no Server Component cache retains user data.

---

## 10. Authed shell `src/app/(app)/layout.tsx`

Server Component. Reads the session; if absent, `redirect('/login')` (defence in depth behind middleware). Renders:
- `Navbar` — ContractIQ wordmark → `/dashboard`, "Review a Contract" CTA, user menu (email, plan badge, Settings, Sign out).
- `SystemStatusBanner` — client island polling `GET /api/system-status` every 60 s; renders the P0/P1 message when `level !== 'none'` (spec 14).
- `{children}`.
- `Footer` — "Powered by OpenAI GPT-4o", legal links, and a "Service status" link to `publicConfig.statusPageUrl` (hidden when empty; spec 14 §2b).

---

## 11. `/settings` (auth-adjacent parts)

- **Plan card** — current `plan`, analyses used this period vs. the quota, and `trial_ends_at` countdown for `free_trial`. Because there is no payment provider at MVP (A-06), the card shows plain copy: "Plan changes are handled by our team — email support@contractiq.app." No upgrade button, no checkout.
- **Feedback opt-in switch** — toggles `profiles.feedback_opt_in` via a Server Action. Helper text: "Allow ContractIQ to use your anonymised term corrections to improve extraction quality. Your contract text is never shared." Default off.
- **Danger zone** — "Delete my account and all data" (spec 11).

---

## 12. Telemetry

`recordEvent({ eventType: 'auth_complete', durationMs })` is written from the client immediately after a successful sign-up or sign-in, measuring from form submit to the dashboard route commit. This is the evidence for the ≤ 10 s target (US-001, engineering-doc Appendix B).
`session_start` is recorded once per browser session on the first authed page load.

---

## 13. Tests

- `tests/e2e/auth.spec.ts` — sign-up → empty dashboard; sign-in → dashboard; sign-out returns to `/`; protected route while signed out redirects to `/login?next=…` and, after signing in, lands on the originally requested page; the whole sign-in flow asserts **< 10 s**.
- `tests/integration/profiles-trigger.test.ts` — one `profiles` row per new auth user, with `plan='free_trial'` and a `trial_ends_at` 14 days out.
- `tests/unit/auth-form.test.tsx` — submit disabled until valid; each error string renders; password rule boundaries (7 vs 8 chars, letters-only, digits-only).
- `tests/e2e/auth-confirmation.spec.ts` — with `NEXT_PUBLIC_EMAIL_CONFIRMATION_ENABLED=true` and the Supabase toggle on, sign-up shows the inbox message and `/auth/callback?code=…` lands on `/dashboard`.
