import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { assertLocalSupabase, loadTestEnv, supabaseGuardMessage } from '../supabase-guard';

/**
 * G35. The integration, RLS and E2E suites create and delete accounts, so they
 * must never start against a hosted Supabase project.
 */

describe('assertLocalSupabase', () => {
  it.each(['http://127.0.0.1:54321', 'http://localhost:54321', 'https://localhost'])(
    'accepts %s',
    (url) => {
      expect(() => assertLocalSupabase(url)).not.toThrow();
    },
  );

  it.each([
    'https://abcdefghijklmnopqrst.supabase.co',
    'http://127.0.0.1.evil.example:54321',
    'http://localhost.example.com',
    'http://10.0.0.5:54321',
    'http://[::1]:54321',
    'not a url',
    '',
    undefined,
  ])('refuses %s', (url) => {
    expect(() => assertLocalSupabase(url)).toThrow(supabaseGuardMessage(url));
  });

  it('names the offending URL and the fix', () => {
    const message = supabaseGuardMessage('https://x.supabase.co');
    expect(message).toContain('"https://x.supabase.co"');
    expect(message).toContain('npm run supabase:start');
    expect(supabaseGuardMessage(undefined)).toContain('not set');
  });
});

describe('loadTestEnv', () => {
  let dir: string;
  const makeDir = (envLocal?: string) => {
    dir = mkdtempSync(join(tmpdir(), 'supabase-guard-'));
    if (envLocal !== undefined) writeFileSync(join(dir, '.env.local'), envLocal);
    return dir;
  };
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('lets process.env win over .env.local for the Supabase variables', () => {
    makeDir(
      [
        'NEXT_PUBLIC_SUPABASE_URL=https://remote.supabase.co',
        'NEXT_PUBLIC_SUPABASE_ANON_KEY=file-anon',
        'SUPABASE_SERVICE_ROLE_KEY=file-service',
        'OPENAI_MODEL=gpt-4o',
      ].join('\n'),
    );
    const env = loadTestEnv(dir, {
      NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321',
      NEXT_PUBLIC_SUPABASE_ANON_KEY: 'env-anon',
      SUPABASE_SERVICE_ROLE_KEY: 'env-service',
      SUPABASE_DB_URL: 'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
    });
    expect(env.NEXT_PUBLIC_SUPABASE_URL).toBe('http://127.0.0.1:54321');
    expect(env.NEXT_PUBLIC_SUPABASE_ANON_KEY).toBe('env-anon');
    expect(env.SUPABASE_SERVICE_ROLE_KEY).toBe('env-service');
    expect(env.SUPABASE_DB_URL).toBe('postgresql://postgres:postgres@127.0.0.1:54322/postgres');
    // Non-Supabase values still come from the file.
    expect(env.OPENAI_MODEL).toBe('gpt-4o');
  });

  it('only overrides the Supabase variables', () => {
    makeDir('NEXT_PUBLIC_SUPABASE_URL=http://localhost:54321\nOPENAI_MODEL=gpt-4o');
    const env = loadTestEnv(dir, { OPENAI_MODEL: 'other' });
    expect(env.OPENAI_MODEL).toBe('gpt-4o');
  });

  it('treats an absent .env.local as empty', () => {
    makeDir();
    const env = loadTestEnv(dir, { NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321' });
    expect(env).toEqual({ NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321' });
  });

  it('refuses a remote URL from .env.local when process.env has none', () => {
    makeDir('NEXT_PUBLIC_SUPABASE_URL=https://remote.supabase.co');
    expect(() => loadTestEnv(dir, {})).toThrow(supabaseGuardMessage('https://remote.supabase.co'));
  });

  it('refuses when no URL is set anywhere', () => {
    makeDir();
    expect(() => loadTestEnv(dir, {})).toThrow(supabaseGuardMessage(undefined));
  });
});
