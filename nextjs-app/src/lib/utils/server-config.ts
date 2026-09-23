import 'server-only';
import { z } from 'zod';

/**
 * Typed, validated SERVER environment (spec 01 §1).
 *
 * Every product limit comes from here. Nothing else reads `process.env`
 * directly except `src/lib/supabase/*`.
 *
 * This module is deliberately SEPARATE from `config.ts`, which holds
 * `publicConfig`. Client Components import `publicConfig`, and a single shared
 * module would drag this schema — including every server-only variable NAME —
 * into the client bundle, which the `scan:secrets` CI gate correctly fails on
 * (spec 13 §9 item 2). `import 'server-only'` now makes the separation a build
 * error rather than a convention.
 */

const num = (d: number) => z.coerce.number().int().default(d);

/**
 * `z.coerce.boolean()` is not usable for env flags: JS `Boolean('false')` is
 * `true`, so any non-empty value would enable the flag. Env booleans are opt-in
 * on the literal string 'true'.
 */
const envBool = (d: boolean) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === '' ? d : v === 'true'));

const serverSchema = z.object({
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  OPENAI_API_KEY: z.string().min(1),
  OPENAI_MODEL: z.string().default('gpt-4o'),
  // Optional override, so the integration suite can point the SDK at a local
  // stub instead of billing real calls (spec 18: "a stubbed OpenAI client").
  // Unset in every real environment, where the SDK uses its own default.
  OPENAI_BASE_URL: z.string().url().optional().or(z.literal('')),
  // General per-attempt timeout: chat (the query enhancer has its own, below).
  OPENAI_TIMEOUT_MS: num(20_000),
  // L5 (spec 06 v1.1 §3/§G): extraction and its JSON repair. A 36-term MSA
  // batch runs 14–16 s live, so the 20 s general timeout left no headroom and
  // killed the 120 s background job on one slow call. The inline path is still
  // bounded by callLlm's deadline cap — min(timeout, remaining − 1 s), and no
  // attempt below 6 s — so this never pushes a request past its 24 s deadline.
  OPENAI_EXTRACTION_TIMEOUT_MS: num(45_000),
  OPENAI_MAX_RETRIES: num(3),
  OPENAI_EXTRACTION_MAX_TOKENS: num(4000), // v1.1 D47 c: per parallel batch (spec 06 v1.1 §G)
  OPENAI_SUMMARY_MAX_TOKENS: num(500),
  OPENAI_SUMMARY_TEMPERATURE: z.coerce.number().default(0.2),
  // Stage 5d-0 L4: D45 sends the full contract text; 10 s was sized for the
  // windowed design. runSummary caps this by the caller's deadline.
  OPENAI_SUMMARY_TIMEOUT_MS: num(20_000),
  OPENAI_CHAT_MAX_TOKENS: num(1000),
  // Spec 08 v1.1 §B: the query enhancer is one small call, 5 s, never retried;
  // it can add latency to a chat turn but never block one.
  OPENAI_ENHANCER_TIMEOUT_MS: num(5_000),
  OPENAI_ENHANCER_MAX_TOKENS: num(120),
  OPENAI_EXTRACTION_TEMPERATURE: z.coerce.number().default(0.1),
  OPENAI_CHAT_TEMPERATURE: z.coerce.number().default(0.4),
  OPENAI_INPUT_COST_PER_1K: z.coerce.number().default(0.005),
  OPENAI_OUTPUT_COST_PER_1K: z.coerce.number().default(0.015),
  OPENAI_MONTHLY_BUDGET_USD: z.coerce.number().default(300),
  // v2.0: extraction.v2 (the 36-term library). v2.1: the chat prompt gained
  // spec 13 v1.1 §A's harmless sentence — bumped per the .env.example rule.
  // The extraction prompt itself is still EXTRACTION_PROMPT_VERSION 'v2.0'.
  PROMPT_VERSION: z.string().default('v2.1'),
  // Per-purpose model ids (spec 01 v1.1 §B). Unset ⇒ OPENAI_MODEL. The judge is
  // eval-only and must differ from the product models (spec 22 §6.1).
  OPENAI_MODEL_EXTRACTION: z.string().optional().or(z.literal('')),
  OPENAI_MODEL_CHAT: z.string().optional().or(z.literal('')),
  OPENAI_MODEL_SUMMARY: z.string().optional().or(z.literal('')),
  OPENAI_MODEL_ENHANCER: z.string().optional().or(z.literal('')),
  OPENAI_MODEL_JUDGE: z.string().optional().or(z.literal('')),
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
  QUOTA_PRO_PER_MONTH: num(0), // 0 = unlimited
  TRIAL_DAYS: num(14),
  CALIBRATION_WARNING_ACTIVE: envBool(false),
  SLACK_ALERT_WEBHOOK_URL: z.string().url().optional().or(z.literal('')),
  COMMIT_SHA: z.string().default('dev'),
  // D49 a (spec 06 v1.1 §G): set ⇒ POST /process hands the pipeline to the
  // Netlify background function and returns 202; unset ⇒ inline (dev, tests).
  PROCESS_JOB_SECRET: z.string().optional().or(z.literal('')),
  // Test/override only: where the signed job is posted. Unset ⇒ the site's own
  // /.netlify/functions/process-background.
  PROCESS_JOB_URL: z.string().url().optional().or(z.literal('')),
  // The background function's own budget for extraction → persist → summary.
  PROCESS_JOB_BUDGET_MS: num(120_000),
});

export type ServerConfig = z.infer<typeof serverSchema>;

let cached: ServerConfig | null = null;

/**
 * Parsed lazily so that importing a module that transitively touches config
 * from a build-time context without secrets does not crash the build. The
 * first call in a request path throws on a missing key, as specified.
 */
export function getServerConfig(): ServerConfig {
  if (!cached) {
    const parsed = serverSchema.safeParse(process.env);
    if (!parsed.success) {
      const missing = parsed.error.issues.map((i) => i.path.join('.')).join(', ');
      throw new Error(`Invalid server environment configuration: ${missing}`);
    }
    cached = parsed.data;
  }
  return cached;
}

