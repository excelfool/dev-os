# 01 — Configuration and Shared Libraries

**Sources:** engineering-doc §6.2 (validation, error handling, observability), §12 (env var names); PRD §5.
**Delivers:** `src/lib/utils/config.ts`, `src/lib/errors/*`, `src/lib/supabase/*`, `src/lib/utils/normalise-text.ts`, `src/lib/metrics/*`, `src/types/*`.

---

## 1. `src/lib/utils/config.ts` — typed, validated environment

Every limit in the product comes from here. Nothing else reads `process.env` directly except `src/lib/supabase/*` and `openai-client.ts`.

```ts
import { z } from 'zod';

const num = (d: number) => z.coerce.number().int().default(d);

const serverSchema = z.object({
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  OPENAI_API_KEY: z.string().min(1),
  OPENAI_MODEL: z.string().default('gpt-4o'),
  OPENAI_TIMEOUT_MS: num(20_000),
  OPENAI_MAX_RETRIES: num(3),
  OPENAI_EXTRACTION_MAX_TOKENS: num(2000),
  OPENAI_CHAT_MAX_TOKENS: num(1000),
  OPENAI_EXTRACTION_TEMPERATURE: z.coerce.number().default(0.1),
  OPENAI_CHAT_TEMPERATURE: z.coerce.number().default(0.4),
  OPENAI_INPUT_COST_PER_1K: z.coerce.number().default(0.005),
  OPENAI_OUTPUT_COST_PER_1K: z.coerce.number().default(0.015),
  OPENAI_MONTHLY_BUDGET_USD: z.coerce.number().default(300),
  PROMPT_VERSION: z.string().default('v1.0'),
  MAX_UPLOAD_MB: num(10),
  MAX_PAGES: num(20),
  MAX_TOKENS: num(15_000),
  MAX_CUSTOM_TERMS: num(5),
  MIN_TEXT_WORDS: num(100),
  SIGNED_URL_TTL_SECONDS: num(3600),
  PDF_RETENTION_DAYS: num(90),
  MAX_CHAT_HISTORY_MESSAGES: num(200),
  MAX_CHAT_HISTORY_TOKENS: num(8000),
  RATE_LIMIT_UPLOAD_PER_HOUR: num(20),
  RATE_LIMIT_PROCESS_PER_HOUR: num(10),
  RATE_LIMIT_CHAT_PER_HOUR: num(30),
  MAX_CONCURRENT_ANALYSES: num(100),
  QUOTA_FREE_TRIAL_TOTAL: num(5),
  QUOTA_STARTER_PER_MONTH: num(10),
  QUOTA_GROWTH_PER_MONTH: num(40),
  QUOTA_PRO_PER_MONTH: num(0),          // 0 = unlimited
  TRIAL_DAYS: num(14),
  CALIBRATION_WARNING_ACTIVE: z.coerce.boolean().default(false),
  SLACK_ALERT_WEBHOOK_URL: z.string().url().optional(),
  COMMIT_SHA: z.string().default('dev'),
});

export const serverConfig = serverSchema.parse(process.env); // throws at boot on a missing key

export const publicConfig = {
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL!,
  supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  siteUrl: process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000',
  maxUploadMb: Number(process.env.NEXT_PUBLIC_MAX_UPLOAD_MB ?? 10),
  maxPages: Number(process.env.NEXT_PUBLIC_MAX_PAGES ?? 20),
  maxCustomTerms: Number(process.env.NEXT_PUBLIC_MAX_CUSTOM_TERMS ?? 5),
  emailConfirmationEnabled: process.env.NEXT_PUBLIC_EMAIL_CONFIRMATION_ENABLED === 'true',
  exportEnabled: process.env.NEXT_PUBLIC_EXPORT_ENABLED === 'true',
  statusPageUrl: process.env.NEXT_PUBLIC_STATUS_PAGE_URL ?? '',
};
```

`serverConfig` must never be imported from a Client Component. Enforce with an ESLint `no-restricted-imports` rule scoped to `src/components/**` and any file carrying `'use client'`.

---

## 2. `src/lib/errors/` — the single error taxonomy

### `error-codes.ts`

Exactly the codes named in engineering-doc §6.2 and §9, each with its HTTP status, user-facing message and retryability. These strings are the literal copy rendered to users — no paraphrasing in components.

| Code | HTTP | `userMessage` | `retryable` |
|---|---|---|---|
| `UNAUTHENTICATED` | 401 | "Please sign in to continue." | false |
| `FORBIDDEN` | 403 | "You don't have access to this contract." | false |
| `NOT_FOUND` | 404 | "We couldn't find that {noun}." — `{noun}` defaults to `contract` | false |
| `NOT_A_PDF` | 400 | "That file isn't a PDF. Please upload a PDF contract." | false |
| `FILE_TOO_LARGE` | 413 | "This file is {size} MB — the limit is 10 MB." | false |
| `TOO_MANY_PAGES` | 422 | "This contract is {pages} pages — the limit is 20 pages for now." | false |
| `TOO_MANY_TOKENS` | 422 | "This contract is longer than we can handle right now — support for longer contracts is coming." | false |
| `SCANNED_PDF` | 422 | "Scanned PDFs are not supported yet." | false |
| `CORRUPT_PDF` | 422 | "We couldn't read this PDF — it may be corrupted. Try re-exporting it and uploading again." | false |
| `QUOTA_EXCEEDED` | 402 | In-plan: "You've used all {limit} analyses on your {plan} plan." Expired free trial (limit 0, no interpolation): "Your free trial has ended — email support@contractiq.app to choose a plan." (spec 13 §5) | false |
| `RATE_LIMITED` | 429 | "You're going a bit fast — try again in {minutes} minutes." | true |
| `CAPACITY` | 503 | "We're handling a lot of contracts right now. Try again in a minute." | true |
| `AI_UNAVAILABLE` | 503 | "We couldn't reach the AI service. Try again in a few minutes." | true |
| `AI_TIMEOUT` | 504 | "We couldn't reach the AI service. Try again in a few minutes." | true |
| `AI_INVALID_OUTPUT` | 502 | "The AI returned an unreadable result. Try again in a few minutes." | true |
| `STORAGE_UNAVAILABLE` | 200 (informational) | "The PDF preview isn't available for this contract — we're showing the text instead." | false |
| `INVALID_TERM_NAME` | 400 | "Custom term names must be 3–60 characters." | false |
| `DUPLICATE_TERM` | 409 | "You've already added that term." | false |
| `CUSTOM_TERM_LIMIT` | 422 | "5 custom terms is the limit for now." | false |
| `ALREADY_PROCESSED` | 409 | "This contract has already been processed." (custom-terms routes append: " — custom terms can only be added beforehand.") | false |
| `ALREADY_PROCESSING` | 409 | "This contract is already being analysed." | false |
| `NOT_PROCESSED` | 409 | "Process this contract before chatting with it." | false |
| `NO_FILE` | 404 | "The original PDF isn't available." | false |
| `INVALID_VALUE` | 400 | "Enter a value between 1 and 2,000 characters." | false |
| `ALREADY_SURVEYED` | 409 | "Thanks — you've already given us feedback recently." | false |
| `PLAN_REQUIRED` | 403 | "Export is available on the Growth and Pro plans. Upgrade to export this review." (returned only to a Starter user whose trial has ended — Free Trial, Growth and Pro can all export, A-16) | false |
| `INTERNAL` | 500 | "Something went wrong on our side. Please try again." | true |

Messages containing `{…}` are interpolated at throw time; the placeholder set is part of the code's contract.

**AMENDED (2026-09-20):** `NOT_FOUND` carries a `{noun}` placeholder. `PATCH
/api/key-terms/{id}` and `DELETE …/custom-terms/{termId}` both return 404 for a
missing or non-owned id, and the original fixed copy told the user
"We couldn't find that **contract**." when the thing not found was a key term.
Parameterising the noun was chosen over adding a second 404 code because
interpolation is this taxonomy's existing extension mechanism, and spec 12 lists
`404 NOT_FOUND` as the single not-found code available on every route — a
sibling code would change that contract for a cosmetic distinction.
`ErrorDefinition` gained an optional `defaults` map so `appError('NOT_FOUND')`
with no vars still reads "We couldn't find that contract." at its most common
call site. Covered by `tests/unit/error-codes.test.ts`.

### `app-error.ts`

```ts
export class AppError extends Error {
  constructor(
    readonly code: ErrorCode,
    readonly httpStatus: number,
    readonly userMessage: string,
    readonly retryable: boolean,
    readonly details?: Record<string, unknown>,
  ) { super(`${code}: ${userMessage}`); }

  toResponse(): Response {
    const headers = new Headers({ 'Content-Type': 'application/json' });
    if (this.code === 'RATE_LIMITED' && this.details?.retryAfterSeconds) {
      headers.set('Retry-After', String(this.details.retryAfterSeconds));
    }
    return new Response(JSON.stringify({
      error: { code: this.code, message: this.userMessage, retryable: this.retryable },
    }), { status: this.httpStatus, headers });
  }
}

export function appError(code: ErrorCode, vars?: Record<string, string | number>): AppError;
```

### `to-user-message.ts`

Maps an unknown thrown value to an `AppError`: `AppError` passes through; `ZodError` becomes `400` with a field error map `{ error: { code: 'VALIDATION', message, fields: {...} } }`; anything else becomes `INTERNAL`. Every Route Handler wraps its body in `withErrorHandling()`, which calls this and returns `err.toResponse()`. **There are no silent failures:** every non-Storage failure produces an error envelope; Storage failures produce a success response carrying `storage_available: false`.

---

## 3. `src/lib/supabase/` — four clients, four jobs

| File | Export | Key used | Where it runs |
|---|---|---|---|
| `client.ts` | `createBrowserSupabaseClient()` via `createBrowserClient` from `@supabase/ssr` | anon | Client Components: auth calls, nothing else privileged |
| `server.ts` | `createServerSupabaseClient()` via `createServerClient` reading/writing the Next.js `cookies()` store | anon + the caller's JWT | Server Components and Route Handlers. **RLS applies.** This is the default for all row access. |
| `admin.ts` | `createAdminSupabaseClient()` with `SUPABASE_SERVICE_ROLE_KEY`, `auth: { persistSession: false }` | service_role | **Only** the call sites listed in spec 13 §2, which is the single authoritative list the CI grep is written against: `DELETE /api/account` (auth-user deletion), the `purge-expired-pdfs` Edge Function, the `send-notification` Edge Function, and the `increment_rate_limit` / `acquire_analysis_slot` / `release_analysis_slot` / `consume_analysis_quota` / `refund_analysis_quota` RPCs. Plus the operator-only Node scripts `scripts/notify-incident.ts` and `eval/**`, which are never imported by application code and never bundled. Any other import **inside `src/**`** is a review-blocking error. |
| `middleware.ts` | `updateSession(request)` | anon | `src/middleware.ts` — refreshes the session cookie on every matched request |

`admin.ts` begins with `import 'server-only';`.

---

## 4. `src/lib/utils/normalise-text.ts`

Used by source-sentence verification (spec 06) and citation parsing (spec 08).

```ts
// Lower-cases, collapses all whitespace runs to a single space, converts
// curly quotes/apostrophes and en/em dashes to ASCII, strips zero-width chars,
// and trims. Deterministic and pure — 100% unit-test covered.
export function normalise(text: string): string;

// True when `needle` (normalised) occurs inside `haystack` (normalised).
export function containsNormalised(haystack: string, needle: string): boolean;
```

**DEVIATION (implemented 2026-09-20):** `normalise` also **rejoins words broken
across a line break by hyphenation**, before lower-casing. The spec as written
turns a justified PDF's `corpora-\ntion` into `corpora tion`, so the model's
verbatim `corporation` fails `containsNormalised`; `is_source_verified` goes
false and confidence is capped at 49, presenting a correct extraction in the red
"verify this" band and distorting the calibration-error metric. Observed live in
Slice 4 on a real extraction run.

Two cases, distinguished by the character following the break:

| Input | Output | Why |
|---|---|---|
| `agree-\nment` | `agreement` | Next char lowercase ⇒ soft hyphen from justification; drop hyphen and break. |
| `Non-\nSolicitation` | `non-solicitation` | Next char not lowercase ⇒ real compound; drop the break, keep the hyphen, add no space. |
| `AES-\n256` | `aes-256` | Same rule; digits are not lowercase. |

Ordering is load-bearing: de-hyphenation must run **before** `toLowerCase()`,
or `Non-\nSolicitation` looks like the lowercase case and is wrongly fused into
`nonsolicitation`. Covered by `tests/unit/normalise-text.test.ts`.

---

## 5. `src/lib/metrics/`

- `timings.ts` — `async function timed<T>(stage, fn): Promise<{ result: T; durationMs: number }>` plus `recordProcessingRun({ contractId, userId, stage, durationMs, outcome, errorCode })` writing one `processing_runs` row.
- `cost.ts` — `computeCostUsd(promptTokens, completionTokens)` = `promptTokens/1000*OPENAI_INPUT_COST_PER_1K + completionTokens/1000*OPENAI_OUTPUT_COST_PER_1K`, rounded to 6 decimals; and `recordOpenAiCall(row)` writing one `openai_calls` row per attempt (including failed attempts, with the matching `outcome`).
- `events.ts` — `recordEvent({ userId, contractId?, eventType, durationMs?, metadata? })` writing `activity_events`. `eventType` is typed against the **closed vocabulary in spec 14 §3**, which names the single write-site for each value; adding a value means adding it there first. **`metadata` must never contain contract text, term values, or chat content**; a runtime guard rejects any value longer than 200 characters and any key named `content`, `text`, `value` or `source_sentence`.

Structured request logging (engineering-doc §6.2): each Route Handler logs one JSON line `{ requestId, userId, route, method, status, durationMs, outcome, errorCode? }`. Contract text and chat content are never logged.

---

## 6. `src/types/`

- `database.types.ts` — generated by `npm run db:types` after the schema is applied. Never hand-edited.
- `domain.ts` — hand-written domain types used across layers: `ContractType = 'NDA' | 'MSA'`, `ContractStatus`, `KeyTerm`, `CustomTerm`, `ChatMessage`, `QueryClass`, `Plan`, `ConfidenceBand = 'high' | 'medium' | 'low'`.
- `api.ts` — request/response types for every route in spec 12, derived from the zod schemas with `z.infer`.

---

## 7. Validation schemas (`src/lib/validation/`)

One file per payload, imported by **both** the client form and the Route Handler so validation cannot drift.

| File | Schema | Rules |
|---|---|---|
| `upload.schema.ts` | `uploadSchema` | `contract_type: z.enum(['NDA','MSA'])`; file checks are performed imperatively (size, magic bytes, pages, tokens) because `File` cannot be fully expressed in zod |
| `custom-term.schema.ts` | `customTermSchema` | `term_names: z.array(z.string().trim().min(3).max(60)).min(1).max(5)` |
| `chat.schema.ts` | `chatMessageSchema` | `message: z.string().trim().min(1).max(2000)` |
| `key-term.schema.ts` | `keyTermUpdateSchema` | `value: z.string().min(1).max(2000)`; plus `keyTermSchema` for model output (spec 06) |
| `feedback.schema.ts` | `feedbackSchema` | `contract_id: uuid`, `rating: enum(['up','down'])`, `comment: string().max(1000).optional()`, `survey_accuracy: enum(['yes','partially','no']).optional()` |
| `nps.schema.ts` | `npsSchema` | `score: number().int().min(0).max(10)`, `comment: string().max(1000).optional()` |
| `contracts-query.schema.ts` | `contractsQuerySchema` | `sort: enum(['created_at','file_name','contract_type']).default('created_at')`, `order: enum(['asc','desc']).default('desc')`, `page: coerce.number().int().min(1).default(1)`, `page_size: coerce.number().int().min(1).max(50).default(50)`, `type: enum(['NDA','MSA']).optional()`, `status: enum(['uploaded','processing','completed','error']).optional()` |

---

## 8. Route Handler skeleton (every route follows it)

```ts
export const runtime = 'nodejs';        // required wherever pdf-parse or the OpenAI SDK is used

export async function POST(req: Request, { params }: { params: { id: string } }) {
  return withErrorHandling(async () => {
    const supabase = createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw appError('UNAUTHENTICATED');            // layer 2 of 3

    await enforceRateLimit(user.id, 'process');              // spec 13
    const body = schema.parse(await req.json());             // shared zod schema

    // Ownership predicate is ALWAYS explicit, even though RLS also enforces it.
    const { data: row } = await supabase.from('contracts')
      .select('*').eq('id', params.id).eq('user_id', user.id).single();
    if (!row) throw appError('NOT_FOUND');

    ...
  });
}
```

Three independent authorisation layers, none trusted alone: middleware redirect (UX), the per-handler session + ownership check above, and PostgreSQL RLS as the authoritative gate.
