import { createServer, type Server } from 'node:http';
import { spawn, type ChildProcess } from 'node:child_process';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Integration harness (spec 18): the real Route Handlers against the real
 * database, with a STUBBED OpenAI client so no test bills a real call.
 *
 * The stub is an HTTP server speaking the Chat Completions shape; the app is
 * started with OPENAI_BASE_URL pointing at it. Nothing about the handler,
 * service or DB layer is mocked — only the model boundary.
 */

export const TEST_PORT = 3100;
export const BASE_URL = `http://127.0.0.1:${TEST_PORT}`;

function loadEnv(): Record<string, string> {
  const raw = readFileSync(resolve(process.cwd(), '.env.local'), 'utf8');
  const env: Record<string, string> = {};
  for (const line of raw.split('\n')) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (match?.[1] && match[2] !== undefined) env[match[1]] = match[2].trim();
  }
  return env;
}

const env = loadEnv();
const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON_KEY = env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY!;

// ---------------------------------------------------------------------------
// OpenAI stub
// ---------------------------------------------------------------------------

export interface StubResponse {
  /** Body the model "returns". */
  content: string;
  /** HTTP status; non-2xx exercises the retry and error paths. */
  status?: number;
  delayMs?: number;
}

/** Queue of scripted responses; the last one repeats once the queue drains. */
let responseQueue: StubResponse[] = [];
let requestLog: Array<{ model: string; messages: unknown[] }> = [];

export function scriptOpenAi(...responses: StubResponse[]): void {
  responseQueue = [...responses];
}

export function openAiRequests() {
  return requestLog;
}

export function resetOpenAiStub(): void {
  responseQueue = [];
  requestLog = [];
}

let stubServer: Server | null = null;
let stubPort = 0;

async function startOpenAiStub(): Promise<string> {
  stubServer = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', async () => {
      try {
        requestLog.push(JSON.parse(body));
      } catch {
        requestLog.push({ model: 'unparsed', messages: [] });
      }

      const next = responseQueue.length > 1 ? responseQueue.shift()! : responseQueue[0];
      const response = next ?? { content: '{}' };

      if (response.delayMs) await new Promise((r) => setTimeout(r, response.delayMs));

      const status = response.status ?? 200;
      if (status !== 200) {
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'stubbed failure', type: 'server_error' } }));
        return;
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          id: 'chatcmpl-stub',
          object: 'chat.completion',
          created: Math.floor(Date.now() / 1000),
          model: 'gpt-4o',
          choices: [{ index: 0, message: { role: 'assistant', content: response.content }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 1200, completion_tokens: 300, total_tokens: 1500 },
        }),
      );
    });
  });

  await new Promise<void>((done) => {
    stubServer!.listen(0, '127.0.0.1', () => {
      stubPort = (stubServer!.address() as { port: number }).port;
      done();
    });
  });

  return `http://127.0.0.1:${stubPort}/v1`;
}

// ---------------------------------------------------------------------------
// Supabase pass-through proxy, for injecting Storage faults
// ---------------------------------------------------------------------------

/**
 * supabase-js derives every endpoint from ONE base URL — `/auth/v1`, `/rest/v1`
 * and `/storage/v1` all hang off it. So Storage cannot be stubbed the way the
 * model is, by swapping a dedicated base URL: pointing NEXT_PUBLIC_SUPABASE_URL
 * at a stub would take auth and the database with it.
 *
 * Instead this is a transparent proxy that forwards everything to the real
 * project and fails ONLY the paths it is told to. The app is started against
 * the proxy, so auth, RLS and every query stay real while a Storage write
 * returns 500 — which is the exact condition spec 04 §2 step 9 describes.
 */
let proxyServer: Server | null = null;
let failStoragePaths: RegExp | null = null;

export function failStorageWrites(pattern: RegExp | null): void {
  failStoragePaths = pattern;
}

async function startSupabaseProxy(): Promise<string> {
  proxyServer = createServer(async (req, res) => {
    const path = req.url ?? '/';

    if (failStoragePaths && failStoragePaths.test(path)) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ statusCode: '500', error: 'InternalError', message: 'stubbed storage failure' }));
      return;
    }

    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const body = Buffer.concat(chunks);

    const headers = new Headers();
    for (const [key, value] of Object.entries(req.headers)) {
      if (typeof value === 'string' && !['host', 'connection', 'content-length'].includes(key)) {
        headers.set(key, value);
      }
    }

    try {
      const upstream = await fetch(`${SUPABASE_URL}${path}`, {
        method: req.method,
        headers,
        body: ['GET', 'HEAD'].includes(req.method ?? 'GET') ? undefined : body,
      });

      const payload = Buffer.from(await upstream.arrayBuffer());
      const outHeaders: Record<string, string> = {};
      upstream.headers.forEach((value, key) => {
        if (!['content-encoding', 'transfer-encoding', 'content-length'].includes(key)) {
          outHeaders[key] = value;
        }
      });
      res.writeHead(upstream.status, outHeaders);
      res.end(payload);
    } catch (err) {
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'proxy_failed', message: String(err) }));
    }
  });

  await new Promise<void>((done) => {
    proxyServer!.listen(0, '127.0.0.1', () => done());
  });

  const port = (proxyServer!.address() as { port: number }).port;
  return `http://127.0.0.1:${port}`;
}

// ---------------------------------------------------------------------------
// App server
// ---------------------------------------------------------------------------

let appProcess: ChildProcess | null = null;
/**
 * The Supabase URL the APP is configured with. supabase-js derives its auth
 * cookie name from this URL's hostname, so when the app runs against the proxy
 * the cookie must be named for the proxy, not the real project.
 */
let appSupabaseUrl = SUPABASE_URL;

/**
 * `envOverrides` lets a file choose its own limits. The defaults below are
 * deliberately generous: a suite that exercises a route N times would otherwise
 * trip the production per-hour limit and fail for a reason unrelated to what it
 * is testing. The limits themselves are asserted in rate-limit.test.ts, which
 * starts its own app with small values.
 */
export async function startApp(
  envOverrides: Record<string, string> = {},
  options: { proxySupabase?: boolean } = {},
): Promise<void> {
  const baseUrl = await startOpenAiStub();
  // Only files that inject Storage faults pay the proxy's overhead.
  appSupabaseUrl = options.proxySupabase ? await startSupabaseProxy() : SUPABASE_URL;
  const supabaseUrl = appSupabaseUrl;

  appProcess = spawn('npx', ['next', 'dev', '--port', String(TEST_PORT)], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      ...env,
      NEXT_PUBLIC_SUPABASE_URL: supabaseUrl,
      OPENAI_BASE_URL: baseUrl,
      // Keep retries and the deadline short so failure-path tests stay quick.
      OPENAI_MAX_RETRIES: '2',
      OPENAI_TIMEOUT_MS: '4000',
      NEXT_TELEMETRY_DISABLED: '1',
      // Own build directory: sharing `.next` with a dev server or another
      // spawned app corrupts the webpack runtime.
      NEXT_DIST_DIR: '.next-test',
      RATE_LIMIT_UPLOAD_PER_HOUR: '1000',
      RATE_LIMIT_PROCESS_PER_HOUR: '1000',
      RATE_LIMIT_CHAT_PER_HOUR: '1000',
      ...envOverrides,
    },
    stdio: process.env.INT_DEBUG ? 'inherit' : 'ignore',
  });

  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE_URL}/api/health`);
      if (res.ok) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('app did not become healthy in time');
}

export async function stopApp(): Promise<void> {
  appProcess?.kill('SIGTERM');
  appProcess = null;
  failStoragePaths = null;
  appSupabaseUrl = SUPABASE_URL;

  await new Promise<void>((done) => {
    if (!stubServer) return done();
    stubServer.close(() => done());
  });
  stubServer = null;

  await new Promise<void>((done) => {
    if (!proxyServer) return done();
    proxyServer.close(() => done());
  });
  proxyServer = null;
}

// ---------------------------------------------------------------------------
// Accounts and requests
// ---------------------------------------------------------------------------

export interface TestUser {
  id: string;
  email: string;
  cookie: string;
  client: SupabaseClient;
}

/**
 * supabase-js builds its storage key as `sb-<first hostname label>-auth-token`.
 * For the real project that is the project ref; for the local proxy it is
 * "127". Either way it must match what the APP is configured with.
 */
function projectRef(): string {
  return new URL(appSupabaseUrl).hostname.split('.')[0]!;
}

export async function createUser(label: string): Promise<TestUser> {
  const email = `int.${label}.${Date.now()}${Math.floor(Math.random() * 1000)}@gmail.com`;
  const anon = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });
  const { data, error } = await anon.auth.signUp({ email, password: 'intTestPass123' });
  if (error || !data.session || !data.user) {
    throw new Error(`createUser ${label}: ${error?.message ?? 'no session'}`);
  }

  // The cookie shape @supabase/ssr reads on the server.
  const encoded = Buffer.from(JSON.stringify(data.session)).toString('base64');
  const cookie = `sb-${projectRef()}-auth-token=base64-${encoded}`;

  const client = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${data.session.access_token}` } },
  });

  return { id: data.user.id, email, cookie, client };
}

export function admin(): SupabaseClient {
  return createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
}

export async function destroyUser(user: TestUser): Promise<void> {
  const a = admin();
  const { data: folders } = await a.storage.from('contracts').list(user.id);
  const paths: string[] = [];
  for (const folder of folders ?? []) {
    const { data: files } = await a.storage.from('contracts').list(`${user.id}/${folder.name}`);
    for (const file of files ?? []) paths.push(`${user.id}/${folder.name}/${file.name}`);
  }
  if (paths.length > 0) await a.storage.from('contracts').remove(paths);
  await a.auth.admin.deleteUser(user.id);
}

/** The error envelope every route returns on failure (spec 12). */
export interface ErrorEnvelope {
  error: { code: string; message: string; retryable: boolean; fields?: Record<string, string> };
}

/** Upload response: the success shape, with the envelope optional so a test can
 *  assert on either without casting. */
export interface UploadBody {
  contract_id: string;
  page_count: number;
  token_estimate: number;
  storage_available: boolean;
  error?: ErrorEnvelope['error'];
}

export interface ApiResult<T = unknown> {
  status: number;
  body: T;
  headers: Headers;
}

export async function api<T = unknown>(
  user: TestUser | null,
  path: string,
  init: RequestInit = {},
): Promise<ApiResult<T>> {
  const headers = new Headers(init.headers);
  if (user) headers.set('Cookie', user.cookie);
  if (init.body && typeof init.body === 'string') headers.set('Content-Type', 'application/json');

  const res = await fetch(`${BASE_URL}${path}`, { ...init, headers, redirect: 'manual' });
  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { status: res.status, body: body as T, headers: res.headers };
}

export async function uploadPdf(
  user: TestUser,
  pdf: Buffer,
  contractType: 'NDA' | 'MSA',
  fileName = 'fixture.pdf',
): Promise<ApiResult<UploadBody>> {
  const form = new FormData();
  form.append('file', new Blob([new Uint8Array(pdf)], { type: 'application/pdf' }), fileName);
  form.append('contract_type', contractType);

  const res = await fetch(`${BASE_URL}/api/contracts/upload`, {
    method: 'POST',
    headers: { Cookie: user.cookie },
    body: form,
  });
  const body = await res.json().catch(() => null);
  return { status: res.status, body, headers: res.headers };
}

/**
 * Operator-set plan change (A-06). Any suite that uploads more than five
 * contracts must call this: the free trial allows 5 analyses in total, and the
 * counter is deliberately deletion-proof, so a suite cannot reclaim units by
 * cleaning up after itself.
 *
 * Also exercises `on_plan_change_reset_quota`, which zeroes `analyses_used`.
 */
export async function setPlan(
  user: TestUser,
  plan: 'free_trial' | 'starter' | 'growth' | 'pro',
): Promise<void> {
  const { error } = await admin().from('profiles').update({ plan }).eq('id', user.id);
  if (error) throw new Error(`setPlan: ${error.message}`);
}
