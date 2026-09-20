import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Two real accounts, A and B, each holding an anon-key client (NEVER
 * service_role) — spec 02 §8. This suite is the executable form of PRD
 * Assumption 9 ("RLS correctly isolates user data"), which is treated as
 * UNPROVEN until it passes.
 *
 * DEVIATION from spec 02 §8, which says "against a local Supabase": no local
 * stack is running, so the suite targets the project in .env.local. It creates
 * and destroys its own accounts and touches no other data. The service-role key
 * is used ONLY for teardown, which is a sanctioned operator-script call site
 * (spec 13 §2 item 6) and lives outside `src/**`, so the CI grep is unaffected.
 */

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
export const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON_KEY = env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY!;

export interface TestAccount {
  id: string;
  email: string;
  password: string;
  client: SupabaseClient;
  accessToken: string;
}

export function adminClient(): SupabaseClient {
  return createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
}

export function anonClient(): SupabaseClient {
  return createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });
}

export async function createAccount(label: string): Promise<TestAccount> {
  const email = `rls.${label}.${Date.now()}${Math.floor(Math.random() * 1000)}@gmail.com`;
  const password = 'rlsTestPass123';

  const signup = anonClient();
  const { data, error } = await signup.auth.signUp({ email, password });
  if (error || !data.session || !data.user) {
    throw new Error(`could not create account ${label}: ${error?.message ?? 'no session'}`);
  }

  // A client bound to this user's JWT. RLS evaluates auth.uid() from it.
  const client = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${data.session.access_token}` } },
  });

  return {
    id: data.user.id,
    email,
    password,
    client,
    accessToken: data.session.access_token,
  };
}

export async function destroyAccount(account: TestAccount): Promise<void> {
  const admin = adminClient();
  // Storage first — the DB cascade does not reach storage.objects (verified
  // live in Slice 3, spec 11 §3a).
  const { data: folders } = await admin.storage.from('contracts').list(account.id);
  const paths: string[] = [];
  for (const folder of folders ?? []) {
    const { data: files } = await admin.storage
      .from('contracts')
      .list(`${account.id}/${folder.name}`);
    for (const file of files ?? []) paths.push(`${account.id}/${folder.name}/${file.name}`);
  }
  if (paths.length > 0) await admin.storage.from('contracts').remove(paths);
  await admin.auth.admin.deleteUser(account.id);
}

/** A minimal but structurally valid PDF, for Storage-policy tests. */
export const TINY_PDF = Buffer.from(
  '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n' +
    '2 0 obj<</Type/Pages/Kids[]/Count 0>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n',
  'latin1',
);

export interface SeededData {
  contractId: string;
  keyTermId: string;
  customTermId: string;
  sessionId: string;
  messageId: string;
  storagePath: string;
}

/** Seeds one contract and one row in every child table, as the owner. */
export async function seedContract(account: TestAccount): Promise<SeededData> {
  const db = account.client;

  const { data: contract, error: contractError } = await db
    .from('contracts')
    .insert({
      user_id: account.id,
      file_name: 'rls-fixture.pdf',
      contract_type: 'NDA',
      file_size_bytes: 1024,
      page_count: 2,
      token_estimate: 100,
      contract_text: '[PAGE 1]\nGoverning law is Delaware.\n\n[PAGE 2]\nNotice period is 30 days.',
      status: 'completed',
    })
    .select('id')
    .single();
  if (contractError || !contract) throw new Error(`seed contract: ${contractError?.message}`);

  const { data: keyTerm, error: keyTermError } = await db
    .from('key_terms')
    .insert({
      contract_id: contract.id,
      user_id: account.id,
      term_name: 'Governing Law',
      value: 'Delaware',
      page_number: 1,
      confidence_score: 95,
      source_sentence: 'Governing law is Delaware.',
      is_source_verified: true,
      display_rank: 6,
      original_ai_value: 'Delaware',
      is_edited: true,
      edited_at: new Date().toISOString(),
    })
    .select('id')
    .single();
  if (keyTermError || !keyTerm) throw new Error(`seed key_term: ${keyTermError?.message}`);

  const { data: customTerm, error: customError } = await db
    .from('custom_key_terms')
    .insert({ contract_id: contract.id, user_id: account.id, term_name: 'Escrow terms' })
    .select('id')
    .single();
  if (customError || !customTerm) throw new Error(`seed custom_term: ${customError?.message}`);

  const { data: session, error: sessionError } = await db
    .from('chat_sessions')
    .insert({ contract_id: contract.id, user_id: account.id })
    .select('id')
    .single();
  if (sessionError || !session) throw new Error(`seed session: ${sessionError?.message}`);

  const { data: message, error: messageError } = await db
    .from('chat_messages')
    .insert({ session_id: session.id, user_id: account.id, role: 'user', content: 'Which law?' })
    .select('id')
    .single();
  if (messageError || !message) throw new Error(`seed message: ${messageError?.message}`);

  await db.from('user_feedback').insert({
    user_id: account.id,
    contract_id: contract.id,
    rating: 'up',
    contract_type: 'NDA',
  });
  await db.from('processing_runs').insert({
    contract_id: contract.id,
    user_id: account.id,
    stage: 'total',
    duration_ms: 1000,
    outcome: 'success',
  });
  await db.from('openai_calls').insert({
    user_id: account.id,
    contract_id: contract.id,
    purpose: 'extraction',
    model: 'gpt-4o',
    outcome: 'success',
    prompt_version: 'v1.0',
  });
  await db.from('activity_events').insert({
    user_id: account.id,
    contract_id: contract.id,
    event_type: 'results_viewed',
  });
  await db.from('nps_responses').insert({ user_id: account.id, score: 9 });

  const storagePath = `${account.id}/${contract.id}/rls-fixture.pdf`;
  const { error: uploadError } = await db.storage
    .from('contracts')
    .upload(storagePath, TINY_PDF, { contentType: 'application/pdf', upsert: true });
  if (uploadError) throw new Error(`seed storage: ${uploadError.message}`);

  return {
    contractId: contract.id,
    keyTermId: keyTerm.id,
    customTermId: customTerm.id,
    sessionId: session.id,
    messageId: message.id,
    storagePath,
  };
}
