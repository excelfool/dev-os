// Supabase Edge Function (Deno). Scheduled nightly at 03:00 UTC by pg_cron.
//
// Per A-02, Edge Functions are used ONLY for scheduled/background jobs with no
// latency budget. Every request/response API is a Next.js Route Handler.
//
// Retention rule (spec 11 §2): the stored PDF is removed 90 days after last
// access. The contracts row, contract_text, key_terms, custom_key_terms and the
// whole chat history are PRESERVED — they are the user's review record.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const BATCH_SIZE = 500;
const MAX_BATCHES = 10;
const RETENTION_DAYS = Number(Deno.env.get('PDF_RETENTION_DAYS') ?? '90');

Deno.serve(async (req: Request) => {
  // The cron call sends the service-role key as a Bearer token; anything else
  // is rejected.
  const auth = req.headers.get('Authorization');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  if (auth !== `Bearer ${serviceKey}`) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401 });
  }

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, serviceKey, {
    auth: { persistSession: false },
  });

  let scanned = 0;
  let purged = 0;
  let failed = 0;

  for (let batch = 0; batch < MAX_BATCHES; batch += 1) {
    const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();

    const { data: rows, error } = await supabase
      .from('contracts')
      .select('id, user_id, file_path')
      .not('file_path', 'is', null)
      .lt('last_accessed_at', cutoff)
      .order('last_accessed_at', { ascending: true })
      .limit(BATCH_SIZE);

    if (error) break;
    if (!rows || rows.length === 0) break;

    scanned += rows.length;

    for (const row of rows) {
      const { error: removeError } = await supabase.storage
        .from('contracts')
        .remove([row.file_path as string]);

      // "Object not found" is a success for our purposes — the goal state is
      // reached. Any other error leaves file_path intact for the next run.
      if (removeError && !/not.?found/i.test(removeError.message)) {
        failed += 1;
        continue;
      }

      const { error: updateError } = await supabase
        .from('contracts')
        .update({ file_path: null, pdf_purged_at: new Date().toISOString() })
        .eq('id', row.id);

      if (updateError) failed += 1;
      else purged += 1;
    }

    if (rows.length < BATCH_SIZE) break;
  }

  // Prune spent rate-limit windows while we are here (spec 11 §2 step 5).
  const rateCutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  await supabase.from('rate_limits').delete().lt('window_start', rateCutoff);

  const result = { scanned, purged, failed };
  console.log(JSON.stringify({ job: 'purge-expired-pdfs', ...result }));
  return new Response(JSON.stringify(result), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
});
