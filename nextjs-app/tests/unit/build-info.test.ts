import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/** The commit is captured when `npm run build` runs, from Netlify's COMMIT_REF. */
describe('scripts/write-build-info.mjs', () => {
  function run(env: Record<string, string>) {
    const out = join(mkdtempSync(join(tmpdir(), 'build-info-')), 'build-info.ts');
    execFileSync('node', ['scripts/write-build-info.mjs', '--out', out], {
      // Start from the parent env for Node's own needs, but never let a commit
      // variable from the outer shell leak into a case that expects none.
      env: { ...process.env, COMMIT_REF: undefined, COMMIT_SHA: undefined, ...env },
    });
    return readFileSync(out, 'utf8');
  }

  it("embeds Netlify's COMMIT_REF", () => {
    expect(run({ COMMIT_REF: 'abc1234deadbeef' })).toContain('export const BUILD_COMMIT = "abc1234deadbeef";');
  });

  it('falls back to COMMIT_SHA, then to dev', () => {
    expect(run({ COMMIT_SHA: 'feedface' })).toContain('"feedface"');
    expect(run({})).toContain('"dev"');
  });

  it('refuses to embed anything that is not a plain token', () => {
    expect(() => run({ COMMIT_REF: 'abc"; process.exit(1); //' })).toThrow();
  });
});
