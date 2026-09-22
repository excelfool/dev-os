import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * The one guard every database-touching suite (integration, RLS, E2E) imports:
 * the tests create and delete accounts and rows, so they run only against a
 * local Supabase stack (`npm run supabase:start`), never a hosted project.
 *
 * Values already in process.env win over .env.local for the Supabase
 * variables, so the sandbox's exports point the suites at the local stack
 * without touching .env.local; an absent .env.local is not an error.
 */

export const SUPABASE_ENV_KEYS = [
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'SUPABASE_DB_URL',
] as const;

const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost']);

export function supabaseGuardMessage(url: string | undefined): string {
  return (
    `Refusing to run: NEXT_PUBLIC_SUPABASE_URL is ${url ? `"${url}"` : 'not set'}. ` +
    'The integration, RLS and E2E suites run only against a local Supabase stack ' +
    '(host 127.0.0.1 or localhost). Run `npm run supabase:start` and export the local URL and keys.'
  );
}

/** Throws unless `url` parses and its host is 127.0.0.1 or localhost. */
export function assertLocalSupabase(url: string | undefined): void {
  let host: string | null = null;
  try {
    host = url ? new URL(url).hostname : null;
  } catch {
    host = null;
  }
  if (!host || !LOCAL_HOSTS.has(host)) throw new Error(supabaseGuardMessage(url));
}

function readEnvLocal(dir: string): Record<string, string> {
  const path = resolve(dir, '.env.local');
  if (!existsSync(path)) return {};
  const env: Record<string, string> = {};
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (match?.[1] && match[2] !== undefined) env[match[1]] = match[2].trim();
  }
  return env;
}

/**
 * .env.local (if present) with process.env overriding the Supabase variables,
 * guarded: throws before any suite can reach a non-local database.
 */
export function loadTestEnv(
  dir: string = process.cwd(),
  processEnv: Readonly<Record<string, string | undefined>> = process.env,
): Record<string, string> {
  const env = readEnvLocal(dir);
  for (const key of SUPABASE_ENV_KEYS) {
    const value = processEnv[key];
    if (value) env[key] = value;
  }
  assertLocalSupabase(env.NEXT_PUBLIC_SUPABASE_URL);
  return env;
}
