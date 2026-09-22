import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { admin, createUser, destroyUser, startApp, stopApp, uploadPdf, type TestUser } from './harness';
import { SHORT_NDA } from './pdf-fixtures';

/**
 * Spec 06 §3a / v1.1 §G — dead-job recovery. `reclaim-stale-processing` is a
 * pg_cron job (schedule: every 5 minutes, supabase/database.sql) on the real project. The
 * test suite has no SQL path to run its body directly, so this test does what
 * a stranded contract does: sits in `processing` with a 6-minute-old claim and
 * waits for the next tick to flip it to `error` / AI_TIMEOUT. Worst case one
 * full interval plus slack.
 */

let user: TestUser;

beforeAll(async () => {
  await startApp();
  user = await createUser('reclaim');
}, 180_000);

afterAll(async () => {
  await destroyUser(user);
  await stopApp();
}, 120_000);

describe('reclaim-stale-processing', () => {
  it('flips a processing row whose claim is 6 minutes old to error/AI_TIMEOUT on the next tick', async () => {
    const up = await uploadPdf(user, SHORT_NDA, 'NDA');
    expect(up.status).toBe(201);
    const id = up.body.contract_id;

    const { error } = await admin()
      .from('contracts')
      .update({ status: 'processing', processing_started_at: new Date(Date.now() - 6 * 60_000).toISOString() })
      .eq('id', id);
    expect(error).toBeNull();

    const deadline = Date.now() + 5.5 * 60_000;
    let row: { status: string; error_code: string | null } | null = null;
    while (Date.now() < deadline) {
      const { data } = await admin().from('contracts').select('status, error_code').eq('id', id).single();
      row = data;
      if (row?.status !== 'processing') break;
      await new Promise((r) => setTimeout(r, 5_000));
    }
    expect(row?.status).toBe('error');
    expect(row?.error_code).toBe('AI_TIMEOUT');
  }, 6 * 60_000);
});
