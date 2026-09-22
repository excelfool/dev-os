-- =====================================================================
-- ContractIQ — complete database schema (FR-13, FR-14)
-- Target: a fresh Supabase project. Paste into the Supabase SQL Editor
-- and run top-to-bottom. Idempotent: safe to re-run.
--
-- Covers: extensions, tables (dependency order), constraints, FKs,
-- indexes, updated_at triggers, auth trigger, custom-term-cap trigger,
-- term_corrections view, RLS enabled + policies on every table,
-- the private `contracts` Storage bucket and its 3 Storage policies,
-- the system_status seed row, and the nightly pg_cron retention job.
--
-- Source: engineering-doc.md §7, §6.2; PRD FR-13, FR-14, §5 retention,
-- Assumption 13.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 0. Extensions
-- ---------------------------------------------------------------------
create extension if not exists pgcrypto with schema extensions;   -- gen_random_uuid()
create extension if not exists pg_cron;                            -- nightly retention job
create extension if not exists pg_net with schema extensions;      -- cron -> Edge Function invoke

-- ---------------------------------------------------------------------
-- 1. Shared trigger function: updated_at
-- ---------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------
-- 2. profiles  (engineering-doc §7.1)
-- ---------------------------------------------------------------------
create table if not exists public.profiles (
  id              uuid primary key references auth.users(id) on delete cascade,
  email           text        not null,
  plan            text        not null default 'free_trial'
                    check (plan in ('free_trial','starter','growth','pro')),
  trial_ends_at   timestamptz,
  feedback_opt_in boolean     not null default false,
  -- Deletion-proof analysis quota counter: monotonic within the current period,
  -- never decremented when a contract is deleted (PRD §12 counts *analyses*,
  -- PRD §5 lets a user delete any contract at any time).
  analyses_used      integer     not null default 0 check (analyses_used >= 0),
  quota_period_start timestamptz not null default date_trunc('month', now()),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

drop trigger if exists set_profiles_updated_at on public.profiles;
create trigger set_profiles_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- Profile row is created by trigger on auth.users insert.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, plan, trial_ends_at, feedback_opt_in)
  values (new.id, new.email, 'free_trial', now() + interval '14 days', false)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------
-- 3. contracts  (engineering-doc §7.2)
-- ---------------------------------------------------------------------
create table if not exists public.contracts (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid        not null references public.profiles(id) on delete cascade,
  file_name             text        not null,
  contract_type         text        not null check (contract_type in ('NDA','MSA')),
  detected_type         text        check (detected_type in ('NDA','MSA','OTHER')),
  type_mismatch_warning boolean     not null default false,
  file_path             text,                       -- NULL is valid: storage failure or 90-day purge
  file_size_bytes       integer     not null check (file_size_bytes > 0 and file_size_bytes <= 10485760),
  page_count            integer     not null check (page_count between 1 and 20),
  token_estimate        integer     not null check (token_estimate >= 0 and token_estimate <= 15000),
  contract_text         text        not null,
  status                text        not null default 'uploaded'
                          check (status in ('uploaded','processing','completed','error')),
  error_code            text,
  error_message         text,
  first_term_ready_ms   integer,
  processing_started_at timestamptz,          -- set when status flips to 'processing'; NEVER touched by the
                                            -- last_accessed_at poll, so stale-run detection stays honest
  processed_at          timestamptz,
  review_completed_at   timestamptz,
  last_accessed_at      timestamptz not null default now(),
  pdf_purged_at         timestamptz,
  prompt_version        text        not null default 'v1.0',
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

drop trigger if exists set_contracts_updated_at on public.contracts;
create trigger set_contracts_updated_at
  before update on public.contracts
  for each row execute function public.set_updated_at();

create index if not exists idx_contracts_user_created
  on public.contracts (user_id, created_at desc);
create index if not exists idx_contracts_user_type
  on public.contracts (user_id, contract_type);
create index if not exists idx_contracts_user_name
  on public.contracts (user_id, file_name);
create index if not exists idx_contracts_retention
  on public.contracts (last_accessed_at) where file_path is not null;
create index if not exists idx_contracts_status
  on public.contracts (user_id, status);
create index if not exists idx_contracts_stale_processing
  on public.contracts (processing_started_at) where status = 'processing';

-- ---------------------------------------------------------------------
-- 4. key_terms  (engineering-doc §7.3)
-- ---------------------------------------------------------------------
create table if not exists public.key_terms (
  id                 uuid primary key default gen_random_uuid(),
  contract_id        uuid        not null references public.contracts(id) on delete cascade,
  user_id            uuid        not null references public.profiles(id) on delete cascade,
  term_name          text        not null check (length(btrim(term_name)) > 0),
  value              text,                           -- NULL => "Not found in document"
  page_number        integer     check (page_number >= 1),
  confidence_score   integer     not null check (confidence_score between 0 and 100),
  source_sentence    text,
  is_source_verified boolean     not null default false,
  is_custom          boolean     not null default false,
  display_rank       integer     not null default 99,
  original_ai_value  text,                           -- captured at insert, never overwritten
  is_edited          boolean     not null default false,
  edited_at          timestamptz,
  created_at         timestamptz not null default now(),
  constraint key_terms_contract_term_unique unique (contract_id, term_name)
);

create index if not exists idx_key_terms_contract
  on public.key_terms (contract_id, display_rank, term_name);
create index if not exists idx_key_terms_user_edited
  on public.key_terms (user_id, is_edited) where is_edited;
create index if not exists idx_key_terms_low_conf
  on public.key_terms (contract_id) where confidence_score < 50;

-- ---------------------------------------------------------------------
-- 5. custom_key_terms  (engineering-doc §7.4, FR-05)
-- ---------------------------------------------------------------------
create table if not exists public.custom_key_terms (
  id          uuid primary key default gen_random_uuid(),
  contract_id uuid        not null references public.contracts(id) on delete cascade,
  user_id     uuid        not null references public.profiles(id) on delete cascade,
  term_name   text        not null check (length(btrim(term_name)) between 3 and 60),
  is_manual   boolean     not null default true,
  created_at  timestamptz not null default now()
);

create unique index if not exists custom_key_terms_contract_name_unique
  on public.custom_key_terms (contract_id, lower(term_name));
create index if not exists idx_custom_terms_contract
  on public.custom_key_terms (contract_id);

-- Hard cap of 5 custom terms per contract, enforced even if the API is bypassed.
create or replace function public.enforce_custom_term_limit()
returns trigger
language plpgsql
as $$
declare
  existing integer;
begin
  select count(*) into existing
  from public.custom_key_terms
  where contract_id = new.contract_id;

  if existing >= 5 then
    raise exception 'CUSTOM_TERM_LIMIT: 5 custom terms is the limit for now.'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists enforce_custom_term_limit on public.custom_key_terms;
create trigger enforce_custom_term_limit
  before insert on public.custom_key_terms
  for each row execute function public.enforce_custom_term_limit();

-- ---------------------------------------------------------------------
-- 6. chat_sessions / chat_messages  (engineering-doc §7.5, §7.6)
-- ---------------------------------------------------------------------
create table if not exists public.chat_sessions (
  id              uuid primary key default gen_random_uuid(),
  contract_id     uuid        not null references public.contracts(id) on delete cascade,
  user_id         uuid        not null references public.profiles(id) on delete cascade,
  last_message_at timestamptz,
  created_at      timestamptz not null default now(),
  constraint chat_sessions_contract_unique unique (contract_id)
);

create index if not exists idx_chat_sessions_contract
  on public.chat_sessions (contract_id);

create table if not exists public.chat_messages (
  id                uuid primary key default gen_random_uuid(),
  session_id        uuid        not null references public.chat_sessions(id) on delete cascade,
  user_id           uuid        not null references public.profiles(id) on delete cascade,
  role              text        not null check (role in ('user','assistant')),
  content           text        not null,
  cited_pages       integer[],
  citation_verified boolean     not null default false,
  query_class       text        check (query_class in ('contract','history','both')),
  latency_ms        integer,
  prompt_tokens     integer,
  completion_tokens integer,
  created_at        timestamptz not null default now()
);

create index if not exists idx_chat_messages_session_created
  on public.chat_messages (session_id, created_at asc);

-- ---------------------------------------------------------------------
-- 7. user_feedback  (engineering-doc §7.7, FR-12)
-- ---------------------------------------------------------------------
create table if not exists public.user_feedback (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid        not null references public.profiles(id) on delete cascade,
  contract_id      uuid        not null references public.contracts(id) on delete cascade,
  rating           text        not null check (rating in ('up','down')),
  comment          text        check (comment is null or length(comment) <= 1000),
  survey_accuracy  text        check (survey_accuracy in ('yes','partially','no')),
  contract_type    text        not null check (contract_type in ('NDA','MSA')),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint user_feedback_user_contract_unique unique (user_id, contract_id)
);

drop trigger if exists set_user_feedback_updated_at on public.user_feedback;
create trigger set_user_feedback_updated_at
  before update on public.user_feedback
  for each row execute function public.set_updated_at();

create index if not exists idx_feedback_contract
  on public.user_feedback (contract_id);

-- ---------------------------------------------------------------------
-- 8. processing_runs  (engineering-doc §7.8)
-- ---------------------------------------------------------------------
create table if not exists public.processing_runs (
  id          uuid primary key default gen_random_uuid(),
  contract_id uuid        not null references public.contracts(id) on delete cascade,
  user_id     uuid        not null references public.profiles(id) on delete cascade,
  stage       text        not null check (stage in ('upload','text_extract','ai_extract','persist','total')),
  duration_ms integer     not null check (duration_ms >= 0),
  outcome     text        not null check (outcome in ('success','error')),
  error_code  text,
  created_at  timestamptz not null default now()
);

create index if not exists idx_processing_runs_stage_created
  on public.processing_runs (stage, created_at desc);

-- ---------------------------------------------------------------------
-- 9. openai_calls  (engineering-doc §7.9)
-- ---------------------------------------------------------------------
create table if not exists public.openai_calls (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid          not null references public.profiles(id) on delete cascade,
  contract_id       uuid          references public.contracts(id) on delete cascade,
  purpose           text          not null check (purpose in ('extraction','chat','repair')),
  model             text          not null,
  prompt_tokens     integer       not null default 0,
  completion_tokens integer       not null default 0,
  cost_usd          numeric(10,6) not null default 0,
  latency_ms        integer       not null default 0,
  attempt           integer       not null default 1,
  outcome           text          not null check (outcome in ('success','timeout','error','invalid_json')),
  prompt_version    text          not null,
  created_at        timestamptz   not null default now()
);

create index if not exists idx_openai_calls_created
  on public.openai_calls (created_at desc);
create index if not exists idx_openai_calls_contract
  on public.openai_calls (contract_id);

-- ---------------------------------------------------------------------
-- 10. activity_events  (engineering-doc §7.10)
-- ---------------------------------------------------------------------
create table if not exists public.activity_events (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid        not null references public.profiles(id) on delete cascade,
  contract_id uuid        references public.contracts(id) on delete cascade,
  event_type  text        not null,
  duration_ms integer,
  metadata    jsonb,
  created_at  timestamptz not null default now()
);

create index if not exists idx_activity_user_created
  on public.activity_events (user_id, created_at desc);
create index if not exists idx_activity_type_created
  on public.activity_events (event_type, created_at desc);

-- ---------------------------------------------------------------------
-- 11. nps_responses  (engineering-doc §7.11)
-- ---------------------------------------------------------------------
create table if not exists public.nps_responses (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid        not null references public.profiles(id) on delete cascade,
  score      integer     not null check (score between 0 and 10),
  comment    text        check (comment is null or length(comment) <= 1000),
  created_at timestamptz not null default now()
);

create index if not exists idx_nps_user_created
  on public.nps_responses (user_id, created_at desc);

-- ---------------------------------------------------------------------
-- 12. rate_limits  (engineering-doc §7.12) — server-side only, no client access
-- ---------------------------------------------------------------------
create table if not exists public.rate_limits (
  user_id      uuid        not null references public.profiles(id) on delete cascade,
  bucket       text        not null check (bucket in ('upload','process','chat')),
  window_start timestamptz not null,
  count        integer     not null default 0,
  primary key (user_id, bucket, window_start)
);

-- Atomic fixed-window increment. Returns the new count for the current hour window.
create or replace function public.increment_rate_limit(
  p_user_id uuid,
  p_bucket  text,
  p_limit   integer
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_window timestamptz := date_trunc('hour', now());
  v_count  integer;
begin
  insert into public.rate_limits (user_id, bucket, window_start, count)
  values (p_user_id, p_bucket, v_window, 1)
  on conflict (user_id, bucket, window_start)
  do update set count = public.rate_limits.count + 1
  returning count into v_count;

  return v_count;  -- caller compares against p_limit and returns 429 if v_count > p_limit
end;
$$;
revoke all on function public.increment_rate_limit(uuid, text, integer) from public, anon, authenticated;
grant execute on function public.increment_rate_limit(uuid, text, integer) to service_role;
-- (The blanket `revoke ... from public` removes the default grant that service_role
--  would otherwise inherit, so this explicit grant is required by its only caller.)

-- ---------------------------------------------------------------------
-- 12a. Analysis quota counter (engineering-doc §6.2 quota; PRD §12 tiers)
--      Atomically rolls the period, increments, and returns the new usage.
--      Monotonic within a period: deleting a contract does NOT free quota.
-- ---------------------------------------------------------------------
create or replace function public.consume_analysis_quota(
  p_user_id      uuid,
  p_period_start timestamptz   -- calendar month start, or trial start for free_trial
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_used integer;
begin
  update public.profiles
     set analyses_used      = case when quota_period_start < p_period_start then 1
                                   else analyses_used + 1 end,
         quota_period_start = greatest(quota_period_start, p_period_start)
   where id = p_user_id
  returning analyses_used into v_used;

  if v_used is null then
    raise exception 'NOT_FOUND: no profile for user';
  end if;

  return v_used;   -- caller compares against the plan limit; > limit => refund + 402
end;
$$;

-- Releases a consumed unit when the upload fails after the counter moved.
create or replace function public.refund_analysis_quota(p_user_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.profiles
     set analyses_used = greatest(analyses_used - 1, 0)
   where id = p_user_id;
$$;

-- A plan change starts a fresh allowance immediately: a user moved from
-- free_trial to starter mid-month must get the full 10 analyses that month
-- (PRD §12), not the trial's remainder. Operator-set plan changes are the only
-- way plan moves at MVP (A-06).
create or replace function public.reset_quota_on_plan_change()
returns trigger
language plpgsql
as $$
begin
  if new.plan is distinct from old.plan then
    new.analyses_used      := 0;
    new.quota_period_start := case
      when new.plan = 'free_trial' then now()
      else date_trunc('month', now())
    end;
  end if;
  return new;
end;
$$;

drop trigger if exists on_plan_change_reset_quota on public.profiles;
create trigger on_plan_change_reset_quota
  before update of plan on public.profiles
  for each row execute function public.reset_quota_on_plan_change();

revoke all on function public.consume_analysis_quota(uuid, timestamptz) from public, anon, authenticated;
revoke all on function public.refund_analysis_quota(uuid)                from public, anon, authenticated;
grant execute on function public.consume_analysis_quota(uuid, timestamptz) to service_role;
grant execute on function public.refund_analysis_quota(uuid)               to service_role;

-- ---------------------------------------------------------------------
-- 12b. Concurrency semaphore for in-flight analyses (engineering-doc §6.2, A-13)
--      Advisory locks are *session*-scoped and PostgREST pools connections, so a
--      lock taken by one request could be released on another. ContractIQ
--      therefore uses a counter table with row-level locking, which is
--      transaction-scoped and pool-safe, and a heartbeat column so a crashed
--      request cannot leak a slot.
-- ---------------------------------------------------------------------
create table if not exists public.analysis_slots (
  slot_id     integer     primary key,
  holder      uuid,                      -- request id; NULL when free
  acquired_at timestamptz
);

alter table public.analysis_slots enable row level security;
revoke all on table public.analysis_slots from anon, authenticated;

-- Seed MAX_CONCURRENT_ANALYSES slots (100).
insert into public.analysis_slots (slot_id)
select generate_series(1, 100)
on conflict (slot_id) do nothing;

-- Claims a free slot (or one whose holder went stale > 2 minutes ago).
-- Returns the slot_id, or NULL when every slot is busy.
create or replace function public.acquire_analysis_slot(p_holder uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_slot integer;
begin
  update public.analysis_slots s
     set holder = p_holder, acquired_at = now()
   where s.slot_id = (
     select slot_id from public.analysis_slots
      where holder is null
         or acquired_at < now() - interval '2 minutes'
      order by slot_id
      for update skip locked
      limit 1
   )
  returning s.slot_id into v_slot;

  return v_slot;
end;
$$;

create or replace function public.release_analysis_slot(p_slot integer, p_holder uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.analysis_slots
     set holder = null, acquired_at = null
   where slot_id = p_slot and holder = p_holder;
$$;

revoke all on function public.acquire_analysis_slot(uuid) from public, anon, authenticated;
revoke all on function public.release_analysis_slot(integer, uuid) from public, anon, authenticated;
grant execute on function public.acquire_analysis_slot(uuid)            to service_role;
grant execute on function public.release_analysis_slot(integer, uuid)   to service_role;

-- ---------------------------------------------------------------------
-- 12c. Transactional key-term persistence (engineering-doc §4.3, §6.2)
--      supabase-js/PostgREST exposes no multi-statement transaction, so the
--      whole replace-and-complete step runs inside this one function. Any
--      failure rolls the function back, so partial key_terms rows can never
--      survive. Called with rpc('persist_key_terms', …) by extraction-service
--      on the caller's JWT, so RLS still applies via the ownership check below.
-- ---------------------------------------------------------------------
create or replace function public.persist_key_terms(
  p_contract_id         uuid,
  p_terms               jsonb,      -- array of the validated key_terms rows
  p_detected_type       text,
  p_type_mismatch       boolean,
  p_first_term_ready_ms integer
)
returns setof public.key_terms
language plpgsql
security invoker
as $$
declare
  v_user_id uuid;
begin
  select user_id into v_user_id
  from public.contracts
  where id = p_contract_id;          -- RLS: returns nothing unless the caller owns it

  if v_user_id is null then
    raise exception 'NOT_FOUND: contract not visible to this user';
  end if;

  delete from public.key_terms where contract_id = p_contract_id;

  insert into public.key_terms (
    contract_id, user_id, term_name, value, page_number, confidence_score,
    source_sentence, is_source_verified, is_custom, display_rank, original_ai_value
  )
  select p_contract_id,
         v_user_id,
         t->>'term_name',
         nullif(t->>'value', ''),
         (t->>'page_number')::integer,
         (t->>'confidence_score')::integer,
         nullif(t->>'source_sentence', ''),
         (t->>'is_source_verified')::boolean,
         (t->>'is_custom')::boolean,
         (t->>'display_rank')::integer,
         nullif(t->>'value', '')
  from jsonb_array_elements(p_terms) as t;

  update public.contracts
     set status                = 'completed',
         processed_at          = now(),
         detected_type         = p_detected_type,
         type_mismatch_warning = p_type_mismatch,
         first_term_ready_ms   = p_first_term_ready_ms,
         processing_started_at = null,
         error_code            = null,
         error_message         = null
   where id = p_contract_id;

  return query
    select * from public.key_terms
     where contract_id = p_contract_id
     order by display_rank, term_name;
end;
$$;

grant execute on function public.persist_key_terms(uuid, jsonb, text, boolean, integer) to authenticated;

-- ---------------------------------------------------------------------
-- 13. system_status  (engineering-doc §7.13) — single row incident banner
-- ---------------------------------------------------------------------
create table if not exists public.system_status (
  id         boolean     primary key default true check (id),
  level      text        not null default 'none' check (level in ('none','p1','p0')),
  message    text        not null default '',
  updated_at timestamptz not null default now()
);

drop trigger if exists set_system_status_updated_at on public.system_status;
create trigger set_system_status_updated_at
  before update on public.system_status
  for each row execute function public.set_updated_at();

insert into public.system_status (id, level, message)
values (true, 'none', '')
on conflict (id) do nothing;

-- ---------------------------------------------------------------------
-- 14. term_corrections view  (engineering-doc §7.14)
-- ---------------------------------------------------------------------
drop view if exists public.term_corrections;
create view public.term_corrections
with (security_invoker = true) as
select kt.id, kt.user_id, kt.contract_id, c.contract_type, c.prompt_version,
       kt.term_name, kt.original_ai_value, kt.value as corrected_value,
       kt.confidence_score, kt.is_custom, kt.edited_at, p.feedback_opt_in
from public.key_terms kt
join public.contracts c on c.id = kt.contract_id
join public.profiles  p on p.id = kt.user_id
where kt.is_edited is true;

-- ---------------------------------------------------------------------
-- 15. Row Level Security — enabled on EVERY table
-- ---------------------------------------------------------------------
alter table public.profiles         enable row level security;
alter table public.contracts        enable row level security;
alter table public.key_terms        enable row level security;
alter table public.custom_key_terms enable row level security;
alter table public.chat_sessions    enable row level security;
alter table public.chat_messages    enable row level security;
alter table public.user_feedback    enable row level security;
alter table public.processing_runs  enable row level security;
alter table public.openai_calls     enable row level security;
alter table public.activity_events  enable row level security;
alter table public.nps_responses    enable row level security;
alter table public.rate_limits      enable row level security;
alter table public.analysis_slots   enable row level security;  -- no policies: server-side only
alter table public.system_status    enable row level security;

-- profiles: owner may read and update; insert via trigger, delete via cascade.
drop policy if exists profiles_select_own on public.profiles;
create policy profiles_select_own on public.profiles
  for select to authenticated using (id = auth.uid());
drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own on public.profiles
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

-- contracts: full owner CRUD.
drop policy if exists contracts_select_own on public.contracts;
create policy contracts_select_own on public.contracts
  for select to authenticated using (user_id = auth.uid());
drop policy if exists contracts_insert_own on public.contracts;
create policy contracts_insert_own on public.contracts
  for insert to authenticated with check (user_id = auth.uid());
drop policy if exists contracts_update_own on public.contracts;
create policy contracts_update_own on public.contracts
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists contracts_delete_own on public.contracts;
create policy contracts_delete_own on public.contracts
  for delete to authenticated using (user_id = auth.uid());

-- key_terms
drop policy if exists key_terms_select_own on public.key_terms;
create policy key_terms_select_own on public.key_terms
  for select to authenticated using (user_id = auth.uid());
drop policy if exists key_terms_insert_own on public.key_terms;
create policy key_terms_insert_own on public.key_terms
  for insert to authenticated with check (user_id = auth.uid());
drop policy if exists key_terms_update_own on public.key_terms;
create policy key_terms_update_own on public.key_terms
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists key_terms_delete_own on public.key_terms;
create policy key_terms_delete_own on public.key_terms
  for delete to authenticated using (user_id = auth.uid());

-- custom_key_terms
drop policy if exists custom_key_terms_select_own on public.custom_key_terms;
create policy custom_key_terms_select_own on public.custom_key_terms
  for select to authenticated using (user_id = auth.uid());
drop policy if exists custom_key_terms_insert_own on public.custom_key_terms;
create policy custom_key_terms_insert_own on public.custom_key_terms
  for insert to authenticated with check (user_id = auth.uid());
drop policy if exists custom_key_terms_update_own on public.custom_key_terms;
create policy custom_key_terms_update_own on public.custom_key_terms
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists custom_key_terms_delete_own on public.custom_key_terms;
create policy custom_key_terms_delete_own on public.custom_key_terms
  for delete to authenticated using (user_id = auth.uid());

-- chat_sessions
drop policy if exists chat_sessions_select_own on public.chat_sessions;
create policy chat_sessions_select_own on public.chat_sessions
  for select to authenticated using (user_id = auth.uid());
drop policy if exists chat_sessions_insert_own on public.chat_sessions;
create policy chat_sessions_insert_own on public.chat_sessions
  for insert to authenticated with check (user_id = auth.uid());
drop policy if exists chat_sessions_update_own on public.chat_sessions;
create policy chat_sessions_update_own on public.chat_sessions
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists chat_sessions_delete_own on public.chat_sessions;
create policy chat_sessions_delete_own on public.chat_sessions
  for delete to authenticated using (user_id = auth.uid());

-- chat_messages
drop policy if exists chat_messages_select_own on public.chat_messages;
create policy chat_messages_select_own on public.chat_messages
  for select to authenticated using (user_id = auth.uid());
drop policy if exists chat_messages_insert_own on public.chat_messages;
create policy chat_messages_insert_own on public.chat_messages
  for insert to authenticated with check (user_id = auth.uid());
drop policy if exists chat_messages_delete_own on public.chat_messages;
create policy chat_messages_delete_own on public.chat_messages
  for delete to authenticated using (user_id = auth.uid());

-- user_feedback
drop policy if exists user_feedback_select_own on public.user_feedback;
create policy user_feedback_select_own on public.user_feedback
  for select to authenticated using (user_id = auth.uid());
drop policy if exists user_feedback_insert_own on public.user_feedback;
create policy user_feedback_insert_own on public.user_feedback
  for insert to authenticated with check (user_id = auth.uid());
drop policy if exists user_feedback_update_own on public.user_feedback;
create policy user_feedback_update_own on public.user_feedback
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists user_feedback_delete_own on public.user_feedback;
create policy user_feedback_delete_own on public.user_feedback
  for delete to authenticated using (user_id = auth.uid());

-- processing_runs: owner SELECT + INSERT (written by the route handler on the user's JWT).
drop policy if exists processing_runs_select_own on public.processing_runs;
create policy processing_runs_select_own on public.processing_runs
  for select to authenticated using (user_id = auth.uid());
drop policy if exists processing_runs_insert_own on public.processing_runs;
create policy processing_runs_insert_own on public.processing_runs
  for insert to authenticated with check (user_id = auth.uid());

-- openai_calls: owner SELECT + INSERT.
drop policy if exists openai_calls_select_own on public.openai_calls;
create policy openai_calls_select_own on public.openai_calls
  for select to authenticated using (user_id = auth.uid());
drop policy if exists openai_calls_insert_own on public.openai_calls;
create policy openai_calls_insert_own on public.openai_calls
  for insert to authenticated with check (user_id = auth.uid());

-- activity_events
drop policy if exists activity_events_select_own on public.activity_events;
create policy activity_events_select_own on public.activity_events
  for select to authenticated using (user_id = auth.uid());
drop policy if exists activity_events_insert_own on public.activity_events;
create policy activity_events_insert_own on public.activity_events
  for insert to authenticated with check (user_id = auth.uid());

-- nps_responses
drop policy if exists nps_responses_select_own on public.nps_responses;
create policy nps_responses_select_own on public.nps_responses
  for select to authenticated using (user_id = auth.uid());
drop policy if exists nps_responses_insert_own on public.nps_responses;
create policy nps_responses_insert_own on public.nps_responses
  for insert to authenticated with check (user_id = auth.uid());

-- rate_limits: RLS enabled with NO policies => no anon/authenticated access at all.
-- Only the service role (which bypasses RLS) and increment_rate_limit() may touch it.
revoke all on table public.rate_limits from anon, authenticated;

-- system_status: readable by any AUTHENTICATED user only (engineering-doc §7.13);
-- anon has no policy, so GET /api/system-status requires a session (spec 12 row 18).
drop policy if exists system_status_select_all on public.system_status;
create policy system_status_select_all on public.system_status
  for select to authenticated using (true);

-- ---------------------------------------------------------------------
-- 16. Storage: private `contracts` bucket + 3 policies  (FR-14, Assumption 13)
--     Path pattern: contracts/{user_id}/{contract_id}/{filename}.pdf
--     NOTE: because the bucket is named `contracts`, object `name` values
--     start at {user_id}; (storage.foldername(name))[1] is therefore the
--     user id, exactly as FR-14 specifies.
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('contracts', 'contracts', false, 10485760, array['application/pdf'])
on conflict (id) do update
  set public = false,
      file_size_limit = 10485760,
      allowed_mime_types = array['application/pdf'];

drop policy if exists contracts_objects_insert_own on storage.objects;
create policy contracts_objects_insert_own on storage.objects
  for insert to authenticated
  with check (bucket_id = 'contracts' and auth.uid()::text = (storage.foldername(name))[1]);

drop policy if exists contracts_objects_select_own on storage.objects;
create policy contracts_objects_select_own on storage.objects
  for select to authenticated
  using (bucket_id = 'contracts' and auth.uid()::text = (storage.foldername(name))[1]);

drop policy if exists contracts_objects_delete_own on storage.objects;
create policy contracts_objects_delete_own on storage.objects
  for delete to authenticated
  using (bucket_id = 'contracts' and auth.uid()::text = (storage.foldername(name))[1]);

-- ---------------------------------------------------------------------
-- 17. Scheduled jobs: nightly PDF retention purge (PRD §5) and the 5-minute
--     stale-`processing` reclaim (spec 06 §3a)
--     Invokes the Edge Function `purge-expired-pdfs` at 03:00 UTC daily.
--     Replace <PROJECT_REF> and store the service-role key in Vault as
--     `service_role_key` before running this block.
-- ---------------------------------------------------------------------
-- select vault.create_secret('<SERVICE_ROLE_KEY>', 'service_role_key');

-- Stale-processing reclaim: a contract whose handler died (function timeout,
-- cold-start kill, crash) would otherwise sit in 'processing' forever, making
-- /process return 409 and the results page poll indefinitely. Every 5 minutes,
-- any row still 'processing' 5 minutes after processing_started_at is flipped to
-- 'error' with a retryable code so the user's "Try again" CTA works.
-- ('updated_at' is unusable here: the results page polls GET /api/contracts/{id}
--  every 2s while processing, and that touch bumps updated_at.)
select cron.unschedule('reclaim-stale-processing')
where exists (select 1 from cron.job where jobname = 'reclaim-stale-processing');

select cron.schedule(
  'reclaim-stale-processing',
  '*/5 * * * *',
  $$
  update public.contracts
     set status        = 'error',
         error_code    = 'AI_TIMEOUT',
         error_message = 'We couldn''t reach the AI service. Try again in a few minutes.'
   where status = 'processing'
     and processing_started_at < now() - interval '5 minutes';
  $$
);

select cron.unschedule('purge-expired-pdfs')
where exists (select 1 from cron.job where jobname = 'purge-expired-pdfs');

select cron.schedule(
  'purge-expired-pdfs',
  '0 3 * * *',
  $$
  select extensions.net_http_post(
    url     := 'https://<PROJECT_REF>.supabase.co/functions/v1/purge-expired-pdfs',
    headers := jsonb_build_object(
                 'Content-Type','application/json',
                 'Authorization','Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key')
               ),
    body    := '{}'::jsonb
  );
  $$
);

-- =====================================================================
-- End of schema.
-- Verification after running:
--   1) select count(*) from pg_tables where schemaname='public';  -- 14 tables
--   2b) select jobname from cron.job;  -- purge-expired-pdfs, reclaim-stale-processing
--   2) select tablename, rowsecurity from pg_tables where schemaname='public';  -- all true
--   3) select id, public from storage.buckets where id='contracts';  -- public = false
--   4) select policyname from pg_policies where tablename='objects' and schemaname='storage';
-- =====================================================================

-- ===== v1.1 additions (PRD v1.1, 2026-09-21) =====
-- Placeholder principle P-3: every table for a planned/stub feature ships now,
-- with RLS and a `-- capability:` header, so a later build is code-only.
-- Idempotent: create table if not exists / add column if not exists /
-- create or replace / drop policy if exists. Safe to re-run on a v1.0 project.
-- Specs: 02 v1.1, 20, 21, 22, 23.

-- ---------------------------------------------------------------------
-- A0. Extension: pgvector (retrieval.vector stub — column present, unused)
-- ---------------------------------------------------------------------
create extension if not exists vector with schema extensions;

-- ---------------------------------------------------------------------
-- A11. Columns added to existing tables (must precede the functions/views)
-- ---------------------------------------------------------------------
alter table public.key_terms add column if not exists reasoning             text;
alter table public.key_terms add column if not exists original_ai_reasoning text;   -- captured at insert, never overwritten
alter table public.key_terms add column if not exists original_ai_page      integer; -- captured at insert, never overwritten
alter table public.key_terms add column if not exists is_required           boolean not null default false;
alter table public.key_terms add column if not exists page_edited           boolean not null default false;
alter table public.key_terms add column if not exists reasoning_edited      boolean not null default false;

alter table public.contracts add column if not exists summary_md           text;
alter table public.contracts add column if not exists summary_status       text not null default 'none';
alter table public.contracts drop constraint if exists contracts_summary_status_check;
alter table public.contracts add constraint contracts_summary_status_check
  check (summary_status in ('none','pending','processing','completed','error'));
alter table public.contracts add column if not exists summary_generated_ms integer;
alter table public.contracts add column if not exists summary_error_code   text;
alter table public.contracts add column if not exists summary_uncited      boolean not null default false;
alter table public.contracts add column if not exists summary_claimed_at   timestamptz;   -- set when POST /summary claims the row; stale after 2 min
alter table public.contracts add column if not exists ocr_confidence       numeric(5,2);
alter table public.contracts drop constraint if exists contracts_ocr_confidence_check;
alter table public.contracts add constraint contracts_ocr_confidence_check
  check (ocr_confidence is null or (ocr_confidence >= 0 and ocr_confidence <= 100));
alter table public.contracts add column if not exists term_library_version text not null default 'v1.0';

-- capability: versioning.duplicate_detect | status: built | phase: v1.1
-- D46 — sha-256 of the raw upload bytes; same-user duplicates are reported on
-- the 201, never rejected.
alter table public.contracts add column if not exists content_hash text;
alter table public.contracts drop constraint if exists contracts_content_hash_check;
alter table public.contracts add constraint contracts_content_hash_check
  check (content_hash is null or content_hash ~ '^[0-9a-f]{64}$');
create index if not exists idx_contracts_user_hash on public.contracts (user_id, content_hash);

-- rollout.cohorts (stub): selects the launch cohort without a deploy (PRD §5)
alter table public.profiles add column if not exists rollout_cohort text not null default 'none';
alter table public.profiles drop constraint if exists profiles_rollout_cohort_check;
alter table public.profiles add constraint profiles_rollout_cohort_check
  check (rollout_cohort in ('none','internal','measurement','beta','ga'));

alter table public.chat_messages add column if not exists enhanced_query text;  -- query-enhancer rewrite, stored on the user row

-- openai_calls.purpose: summary, query_enhancer, risk, judge
alter table public.openai_calls drop constraint if exists openai_calls_purpose_check;
alter table public.openai_calls add constraint openai_calls_purpose_check
  check (purpose in ('extraction','chat','repair','summary','query_enhancer','risk','judge'));

-- processing_runs.stage names the component (PRD §11 error rate per component 1–9)
alter table public.processing_runs drop constraint if exists processing_runs_stage_check;
alter table public.processing_runs add constraint processing_runs_stage_check
  check (stage in ('upload','text_extract','ai_extract','summary','persist','risk','chat','crm_push','total'));  -- component 3 (classify) shares the ai_extract call

-- rate_limits.bucket: risks
alter table public.rate_limits drop constraint if exists rate_limits_bucket_check;
alter table public.rate_limits add constraint rate_limits_bucket_check
  check (bucket in ('upload','process','chat','risks'));

-- persist_key_terms re-declared (same signature): reasoning + originals,
-- is_required, term_library_version, and summary_status='pending'.
create or replace function public.persist_key_terms(
  p_contract_id         uuid,
  p_terms               jsonb,
  p_detected_type       text,
  p_type_mismatch       boolean,
  p_first_term_ready_ms integer
)
returns setof public.key_terms
language plpgsql
security invoker
as $$
declare
  v_user_id uuid;
  v_library text;
begin
  select user_id into v_user_id
  from public.contracts
  where id = p_contract_id;          -- RLS: returns nothing unless the caller owns it

  if v_user_id is null then
    raise exception 'NOT_FOUND: contract not visible to this user';
  end if;

  select max(t->>'term_library_version') into v_library
  from jsonb_array_elements(p_terms) as t;

  delete from public.key_terms where contract_id = p_contract_id;

  insert into public.key_terms (
    contract_id, user_id, term_name, value, page_number, confidence_score,
    source_sentence, is_source_verified, is_custom, display_rank,
    reasoning, is_required,
    original_ai_value, original_ai_page, original_ai_reasoning
  )
  select p_contract_id,
         v_user_id,
         t->>'term_name',
         nullif(t->>'value', ''),
         (t->>'page_number')::integer,
         (t->>'confidence_score')::integer,
         nullif(t->>'source_sentence', ''),
         (t->>'is_source_verified')::boolean,
         (t->>'is_custom')::boolean,
         (t->>'display_rank')::integer,
         nullif(t->>'reasoning', ''),
         coalesce((t->>'is_required')::boolean, false),
         nullif(t->>'value', ''),
         (t->>'page_number')::integer,
         nullif(t->>'reasoning', '')
  from jsonb_array_elements(p_terms) as t;

  update public.contracts
     set status                = 'completed',
         processed_at          = now(),
         detected_type         = p_detected_type,
         type_mismatch_warning = p_type_mismatch,
         first_term_ready_ms   = p_first_term_ready_ms,
         processing_started_at = null,
         error_code            = null,
         error_message         = null,
         summary_status        = 'pending',
         term_library_version  = coalesce(v_library, term_library_version)
   where id = p_contract_id;

  return query
    select * from public.key_terms
     where contract_id = p_contract_id
     order by display_rank, term_name;
end;
$$;

grant execute on function public.persist_key_terms(uuid, jsonb, text, boolean, integer) to authenticated;

-- ---------------------------------------------------------------------
-- A1. playbooks
-- capability: playbook.manage | status: stub | phase: Phase 1
-- ---------------------------------------------------------------------
create table if not exists public.playbooks (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid references public.profiles(id) on delete cascade,  -- NULL = seeded system default
  contract_type text        not null check (contract_type in ('NDA','MSA')),
  name          text        not null check (length(btrim(name)) between 1 and 120),
  version       integer     not null default 1 check (version >= 1),
  is_active     boolean     not null default false,
  is_default    boolean     not null default false,
  source        text        not null default 'in_app' check (source in ('seed','upload','in_app')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

drop trigger if exists set_playbooks_updated_at on public.playbooks;
create trigger set_playbooks_updated_at
  before update on public.playbooks
  for each row execute function public.set_updated_at();

-- exactly one active playbook per (workspace, contract type); the seed counts as workspace NULL
create unique index if not exists playbooks_one_active_per_type
  on public.playbooks (coalesce(user_id, '00000000-0000-0000-0000-000000000000'::uuid), contract_type)
  where is_active;
create index if not exists idx_playbooks_user_type on public.playbooks (user_id, contract_type);

-- ---------------------------------------------------------------------
-- A2. playbook_rules (versioned; never updated in place) + seeded default MSA playbook
-- capability: playbook.manage | status: stub | phase: Phase 1
-- ---------------------------------------------------------------------
create table if not exists public.playbook_rules (
  id            uuid primary key default gen_random_uuid(),
  playbook_id   uuid        not null references public.playbooks(id) on delete cascade,
  user_id       uuid        references public.profiles(id) on delete cascade,   -- denormalised; NULL for the seed
  rule_key      text        not null check (rule_key ~ '^[a-z0-9_.]+$'),
  rule_type     text        not null check (rule_type in ('presence','absence','threshold','pattern')),
  term_name     text,
  condition     jsonb       not null default '{}'::jsonb,
  severity      text        not null check (severity in ('High','Medium','Low')),
  rationale     text        not null check (length(btrim(rationale)) > 0),
  version       integer     not null default 1 check (version >= 1),
  superseded_at timestamptz,
  created_at    timestamptz not null default now()
);

create unique index if not exists playbook_rules_key_version_unique
  on public.playbook_rules (playbook_id, rule_key, version);
create index if not exists idx_playbook_rules_active
  on public.playbook_rules (playbook_id) where superseded_at is null;

-- Seed: the default MSA playbook from the instructor's examples (PRD US-014, R-15).
insert into public.playbooks (id, user_id, contract_type, name, version, is_active, is_default, source)
values ('00000000-0000-0000-0000-00000000a001', null, 'MSA',
        'Default MSA playbook (instructor examples)', 1, true, true, 'seed')
on conflict (id) do nothing;

insert into public.playbook_rules (playbook_id, user_id, rule_key, rule_type, term_name, condition, severity, rationale, version)
select '00000000-0000-0000-0000-00000000a001', null, r.rule_key, r.rule_type, r.term_name, r.condition::jsonb, r.severity, r.rationale, 1
from (values
  ('msa.one_sided_indemnity', 'pattern', 'Customer Indemnity',
   '{"criterion":"Indemnity obligations run in one direction only — one party indemnifies the other with no reciprocal obligation.","also_read":["Service Provider indemnity"]}',
   'High',
   'One-sided indemnity means you carry the other side''s legal costs and losses with nothing in return. Ask for a mutual indemnity or a cap.'),
  ('msa.no_termination_for_convenience', 'presence', 'Termination for convenience (Yes, No, N/A)',
   '{"clause":"termination_for_convenience","expect":true}',
   'High',
   'Without termination for convenience you cannot exit the agreement early unless the other side breaches it. Ask for a notice-based exit.'),
  ('msa.payment_terms_over_60_days', 'threshold', 'Net payment terms (Net 30, 45, 60, 75, 90, other)',
   '{"op":">","value":60,"unit":"days","parse":"net_days"}',
   'Medium',
   'Payment terms longer than 60 days delay your cash flow and are outside the usual Net 30–60 range. Ask for Net 30 or Net 45.'),
  ('msa.missing_dpa_with_personal_data', 'absence', null,
   '{"trigger":"personal_data_language","required":"data_processing_agreement"}',
   'High',
   'The contract handles personal data but has no Data Processing Agreement. Under GDPR a DPA is required whenever personal data is processed on your behalf.'),
  ('msa.missing_baa_with_phi', 'absence', null,
   '{"trigger":"phi_language","required":"business_associate_agreement"}',
   'High',
   'The contract mentions protected health information but has no Business Associate Agreement. HIPAA requires a BAA before PHI is shared.')
) as r(rule_key, rule_type, term_name, condition, severity, rationale)
where not exists (
  select 1 from public.playbook_rules pr
   where pr.playbook_id = '00000000-0000-0000-0000-00000000a001' and pr.rule_key = r.rule_key and pr.version = 1
);

-- ---------------------------------------------------------------------
-- A3. risk_flags
-- capability: risk.flag | status: stub | phase: Phase 1
-- ---------------------------------------------------------------------
create table if not exists public.risk_flags (
  id                    uuid primary key default gen_random_uuid(),
  contract_id           uuid        not null references public.contracts(id) on delete cascade,
  user_id               uuid        not null references public.profiles(id) on delete cascade,
  rule_id               uuid        not null references public.playbook_rules(id) on delete cascade,
  playbook_version      integer     not null,
  verdict               text        not null check (verdict in ('broken','satisfied','not_applicable')),
  severity              text        not null check (severity in ('High','Medium','Low')),
  page_number           integer     check (page_number >= 1),
  source_sentence       text,
  is_source_verified    boolean     not null default false,
  why_this_matters      text        not null default '',
  confidence_score      integer     not null default 0 check (confidence_score between 0 and 100),
  requires_human_review boolean     not null default false,
  decision              text        check (decision in ('accept','dismiss')),
  decided_at            timestamptz,
  was_wrong             boolean     not null default false,
  prompt_version        text        not null default 'risk.v1',
  created_at            timestamptz not null default now(),
  constraint risk_flags_high_requires_review check (severity <> 'High' or requires_human_review),
  constraint risk_flags_contract_rule_unique unique (contract_id, rule_id)
);

create index if not exists idx_risk_flags_contract on public.risk_flags (contract_id, severity);
create index if not exists idx_risk_flags_undecided_high
  on public.risk_flags (contract_id) where severity = 'High' and decision is null;
create index if not exists idx_risk_flags_was_wrong on public.risk_flags (user_id) where was_wrong;

-- ---------------------------------------------------------------------
-- A4. escalations (a human closes every escalation — service role only)
-- capability: risk.escalate | status: stub | phase: Phase 1
-- ---------------------------------------------------------------------
create table if not exists public.escalations (
  id               uuid primary key default gen_random_uuid(),
  contract_id      uuid        not null references public.contracts(id) on delete cascade,
  user_id          uuid        not null references public.profiles(id) on delete cascade,
  trigger          text        not null check (trigger in ('chat_unresolved','high_flag','user_request','comparison_new_high')),
  session_id       uuid        references public.chat_sessions(id) on delete set null,
  risk_flag_id     uuid        references public.risk_flags(id) on delete set null,
  unresolved_turns integer     check (unresolved_turns >= 0),
  note             text        check (note is null or length(note) <= 1000),
  status           text        not null default 'open' check (status in ('open','closed')),
  closed_by        uuid,
  closed_at        timestamptz,
  created_at       timestamptz not null default now()
);

create index if not exists idx_escalations_contract_open
  on public.escalations (contract_id) where status = 'open';

-- risk_flag_corrections: "this flag was wrong" → correction queue (spec 20 §4.4)
drop view if exists public.risk_flag_corrections;
create view public.risk_flag_corrections
with (security_invoker = true) as
select rf.id, rf.user_id, rf.contract_id, c.contract_type, rf.prompt_version,
       pr.rule_key, rf.playbook_version, rf.severity, rf.confidence_score, rf.created_at,
       p.feedback_opt_in
from public.risk_flags rf
join public.playbook_rules pr on pr.id = rf.rule_id
join public.contracts c on c.id = rf.contract_id
join public.profiles p on p.id = rf.user_id
where rf.was_wrong is true;

-- ---------------------------------------------------------------------
-- A5. persist_risk_flags — one-statement transaction, like persist_key_terms
-- ---------------------------------------------------------------------
create or replace function public.persist_risk_flags(
  p_contract_id uuid,
  p_playbook_id uuid,
  p_flags       jsonb
)
returns setof public.risk_flags
language plpgsql
security invoker
as $$
declare
  v_user_id uuid;
  v_version integer;
begin
  select user_id into v_user_id from public.contracts where id = p_contract_id;
  if v_user_id is null then
    raise exception 'NOT_FOUND: contract not visible to this user';
  end if;

  select version into v_version from public.playbooks where id = p_playbook_id;
  if v_version is null then
    raise exception 'NOT_FOUND: playbook not visible to this user';
  end if;

  delete from public.risk_flags where contract_id = p_contract_id;

  insert into public.risk_flags (
    contract_id, user_id, rule_id, playbook_version, verdict, severity, page_number,
    source_sentence, is_source_verified, why_this_matters, confidence_score,
    requires_human_review, prompt_version
  )
  select p_contract_id, v_user_id,
         (f->>'rule_id')::uuid, v_version,
         f->>'verdict', f->>'severity',
         (f->>'page_number')::integer,
         nullif(f->>'source_sentence', ''),
         coalesce((f->>'is_source_verified')::boolean, false),
         coalesce(f->>'why_this_matters', ''),
         coalesce((f->>'confidence_score')::integer, 0),
         (f->>'severity') = 'High',
         coalesce(f->>'prompt_version', 'risk.v1')
  from jsonb_array_elements(p_flags) as f;

  return query
    select * from public.risk_flags
     where contract_id = p_contract_id
     order by case severity when 'High' then 1 when 'Medium' then 2 else 3 end, page_number;
end;
$$;

grant execute on function public.persist_risk_flags(uuid, uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------
-- A6a. integration_connections — the "connect once" record per (user, target)
-- capability: crm.hubspot / crm.salesforce | status: stub | phase: Phase 1
-- Tokens are NEVER stored here: credential_ref names a Vault secret.
-- ---------------------------------------------------------------------
create table if not exists public.integration_connections (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid        not null references public.profiles(id) on delete cascade,
  target              text        not null check (target in ('hubspot','salesforce','docusign','drive','dropbox','sharepoint')),
  status              text        not null default 'connected' check (status in ('connected','disconnected','error')),
  external_account_id text,
  credential_ref      text,       -- vault secret name, e.g. crm_<user_id>_hubspot
  connected_at        timestamptz not null default now(),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint integration_connections_user_target_unique unique (user_id, target)
);

drop trigger if exists set_integration_connections_updated_at on public.integration_connections;
create trigger set_integration_connections_updated_at
  before update on public.integration_connections
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------
-- A6. integration_events
-- capability: crm.hubspot / crm.salesforce / esign.docusign | status: stub | phase: Phase 1
-- ---------------------------------------------------------------------
create table if not exists public.integration_events (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid        not null references public.profiles(id) on delete cascade,
  contract_id        uuid        references public.contracts(id) on delete cascade,
  target             text        not null check (target in ('hubspot','salesforce','docusign','drive','dropbox','sharepoint','n8n')),
  direction          text        not null check (direction in ('push','pull','webhook')),
  status             text        not null check (status in ('success','failed','not_configured')),
  external_record_id text,
  error_code         text,
  payload_hash       text,       -- sha256 of the field map; never the values
  created_at         timestamptz not null default now()
);

create index if not exists idx_integration_events_contract_target
  on public.integration_events (contract_id, target, created_at desc);

-- ---------------------------------------------------------------------
-- A7. key_dates + reminders + mark_due_reminders() + cron stub
-- capability: reminders.key_dates | status: stub | phase: v1.1
-- ---------------------------------------------------------------------
create table if not exists public.key_dates (
  id           uuid primary key default gen_random_uuid(),
  contract_id  uuid        not null references public.contracts(id) on delete cascade,
  user_id      uuid        not null references public.profiles(id) on delete cascade,
  term_id      uuid        references public.key_terms(id) on delete set null,
  kind         text        not null check (kind in ('end_date','renewal_notice_deadline','renewal_date','auto_renewal_check')),
  date         date        not null,
  derived_from jsonb       not null default '{}'::jsonb,
  is_manual    boolean     not null default false,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint key_dates_contract_kind_unique unique (contract_id, kind)
);

drop trigger if exists set_key_dates_updated_at on public.key_dates;
create trigger set_key_dates_updated_at
  before update on public.key_dates
  for each row execute function public.set_updated_at();

create index if not exists idx_key_dates_user_date on public.key_dates (user_id, date);

-- capability: reminders.key_dates | status: stub | phase: v1.1
create table if not exists public.reminders (
  id          uuid primary key default gen_random_uuid(),
  key_date_id uuid        not null references public.key_dates(id) on delete cascade,
  user_id     uuid        not null references public.profiles(id) on delete cascade,
  offset_days integer     not null check (offset_days in (30,60,90)),
  send_at     timestamptz not null,
  channel     text        not null check (channel in ('email','in_app')),
  status      text        not null default 'scheduled' check (status in ('scheduled','due','sent','cancelled')),
  sent_at     timestamptz,
  created_at  timestamptz not null default now(),
  constraint reminders_keydate_offset_channel_unique unique (key_date_id, offset_days, channel)
);

create index if not exists idx_reminders_due on public.reminders (send_at) where status = 'scheduled';
create index if not exists idx_reminders_user_status on public.reminders (user_id, status);

create or replace function public.mark_due_reminders()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  update public.reminders
     set status = 'due'
   where status = 'scheduled'
     and send_at <= now();
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
revoke all on function public.mark_due_reminders() from public, anon, authenticated;
grant execute on function public.mark_due_reminders() to service_role;

select cron.unschedule('mark-due-reminders')
where exists (select 1 from cron.job where jobname = 'mark-due-reminders');
select cron.schedule('mark-due-reminders', '0 8 * * *', $$ select public.mark_due_reminders(); $$);

-- Delivery (send-due-reminders Edge Function → send-notification `key_date_reminder`)
-- is written but undeployed. Uncomment once deployed, after substituting <PROJECT_REF>
-- and storing the service-role key in Vault (see §17 above).
-- select cron.schedule(
--   'send-due-reminders',
--   '5 8 * * *',
--   $$
--   select extensions.net_http_post(
--     url     := 'https://<PROJECT_REF>.supabase.co/functions/v1/send-due-reminders',
--     headers := jsonb_build_object(
--                  'Content-Type','application/json',
--                  'Authorization','Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key')
--                ),
--     body    := '{}'::jsonb
--   );
--   $$
-- );

-- ---------------------------------------------------------------------
-- A8. hhh_scores — the 29-question HHH questionnaire per scored response
-- capability: eval.hhh_human | status: planned | phase: — (first build item)
-- Columns h1…a9 hold the reviewer's literal Yes(true)/No(false)/NULL answer;
-- the trigger derives the pillar verdicts from the instructor polarity:
--   yes_is_failure: H1–H3, O1–O3, A1–A4;  no_is_failure: H4–H11, O4–O9, A5–A9.
-- ---------------------------------------------------------------------
create table if not exists public.hhh_scores (
  id                   uuid primary key default gen_random_uuid(),
  user_id              uuid        not null references public.profiles(id) on delete cascade,
  contract_id          uuid        not null references public.contracts(id) on delete cascade,
  subject_type         text        not null check (subject_type in ('term','message','summary','risk_flag')),
  term_id              uuid        references public.key_terms(id) on delete cascade,
  message_id           uuid        references public.chat_messages(id) on delete cascade,
  risk_flag_id         uuid        references public.risk_flags(id) on delete cascade,
  evaluator            text        not null check (evaluator in ('human','llm-judge')),
  scorer_role          text        check (scorer_role in ('owner','sme')),   -- who answered a human row: owner (Review mode) or sme (sheet import)
  h1 boolean, h2 boolean, h3 boolean, h4 boolean, h5 boolean, h6 boolean,
  h7 boolean, h8 boolean, h9 boolean, h10 boolean, h11 boolean,
  o1 boolean, o2 boolean, o3 boolean, o4 boolean, o5 boolean, o6 boolean,
  o7 boolean, o8 boolean, o9 boolean,
  a1 boolean, a2 boolean, a3 boolean, a4 boolean, a5 boolean, a6 boolean,
  a7 boolean, a8 boolean, a9 boolean,
  helpful_verdict      text        not null default 'pass' check (helpful_verdict in ('pass','fail')),
  honest_verdict       text        not null default 'pass' check (honest_verdict in ('pass','fail')),
  harmless_verdict     text        not null default 'pass' check (harmless_verdict in ('pass','fail')),
  judge_model          text,
  judge_prompt_version text,
  prompt_version       text        not null default 'v1.0',
  term_library_version text,
  notes                text        check (notes is null or length(notes) <= 1000),
  created_by           uuid,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  constraint hhh_scores_subject_check check (
    (subject_type = 'term'      and term_id is not null and message_id is null and risk_flag_id is null) or
    (subject_type = 'message'   and message_id is not null and term_id is null and risk_flag_id is null) or
    (subject_type = 'risk_flag' and risk_flag_id is not null and term_id is null and message_id is null) or
    (subject_type = 'summary'   and term_id is null and message_id is null and risk_flag_id is null)
  ),
  constraint hhh_scores_judge_fields_check check (
    evaluator <> 'llm-judge' or (judge_model is not null and judge_prompt_version is not null)
  ),
  constraint hhh_scores_scorer_role_by_evaluator_check check (
    (evaluator = 'human' and scorer_role is not null) or (evaluator = 'llm-judge' and scorer_role is null)
  )
);
alter table public.hhh_scores add column if not exists scorer_role text;  -- no-op on a fresh project; the CHECKs above own the constraint

drop trigger if exists set_hhh_scores_updated_at on public.hhh_scores;
create trigger set_hhh_scores_updated_at
  before update on public.hhh_scores
  for each row execute function public.set_updated_at();

create or replace function public.compute_hhh_verdicts()
returns trigger
language plpgsql
as $$
begin
  new.helpful_verdict := case when
       coalesce(new.h1, false) or coalesce(new.h2, false) or coalesce(new.h3, false)
    or new.h4 is false or new.h5 is false or new.h6 is false or new.h7 is false
    or new.h8 is false or new.h9 is false or new.h10 is false or new.h11 is false
    then 'fail' else 'pass' end;
  new.honest_verdict := case when
       coalesce(new.o1, false) or coalesce(new.o2, false) or coalesce(new.o3, false)
    or new.o4 is false or new.o5 is false or new.o6 is false
    or new.o7 is false or new.o8 is false or new.o9 is false
    then 'fail' else 'pass' end;
  new.harmless_verdict := case when
       coalesce(new.a1, false) or coalesce(new.a2, false) or coalesce(new.a3, false) or coalesce(new.a4, false)
    or new.a5 is false or new.a6 is false or new.a7 is false or new.a8 is false or new.a9 is false
    then 'fail' else 'pass' end;
  return new;
end;
$$;

drop trigger if exists compute_hhh_verdicts on public.hhh_scores;
create trigger compute_hhh_verdicts
  before insert or update on public.hhh_scores
  for each row execute function public.compute_hhh_verdicts();

create index if not exists idx_hhh_scores_contract on public.hhh_scores (contract_id);
create index if not exists idx_hhh_scores_created on public.hhh_scores (created_at desc);
create index if not exists idx_hhh_scores_evaluator_created on public.hhh_scores (evaluator, created_at desc);
create unique index if not exists hhh_scores_human_one_per_term
  on public.hhh_scores (term_id, created_by) where evaluator = 'human' and term_id is not null;
create unique index if not exists hhh_scores_human_one_per_message
  on public.hhh_scores (message_id, created_by) where evaluator = 'human' and message_id is not null;
create unique index if not exists hhh_scores_human_one_summary_per_contract
  on public.hhh_scores (contract_id, created_by) where evaluator = 'human' and subject_type = 'summary';

-- ---------------------------------------------------------------------
-- A9. guardrail_events — one row per harmless-policy rule firing (hash only)
-- capability: observe.guardrail_events | status: stub | phase: v1.0
-- ---------------------------------------------------------------------
create table if not exists public.guardrail_events (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid        not null references public.profiles(id) on delete cascade,
  contract_id    uuid        references public.contracts(id) on delete cascade,
  message_id     uuid        references public.chat_messages(id) on delete set null,
  rule           text        not null check (rule in ('profanity_hate','competitor_disparagement','stay_within_contract','escalate','no_pii_solicitation','prompt_injection')),
  stage          text        not null check (stage in ('inbound','document','outbound')),
  action         text        not null check (action in ('allow','flag','block','rewrite')),
  input_hash     text        not null check (input_hash ~ '^[0-9a-f]{64}$'),
  matched        text,
  false_positive boolean,
  reviewed_at    timestamptz,
  created_at     timestamptz not null default now()
);

create index if not exists idx_guardrail_events_created on public.guardrail_events (created_at desc);
create index if not exists idx_guardrail_events_rule_created on public.guardrail_events (rule, created_at desc);

-- ---------------------------------------------------------------------
-- A12a. eval_gates — machine-written gate state (judge gate, weekly sample)
-- capability: eval.judge_precision | status: stub | phase: —
-- ---------------------------------------------------------------------
create table if not exists public.eval_gates (
  key        text primary key,
  value      jsonb       not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

insert into public.eval_gates (key, value)
values ('judge_gate', '{"gate_met": false, "judge_model": null, "judge_prompt_version": null, "measured_at": null}'::jsonb)
on conflict (key) do nothing;

-- ---------------------------------------------------------------------
-- A10. alert_rules + alert_events + compute_alert_metric() + evaluate_alert_rules() + cron
-- capability: observe.alerts | status: stub | phase: v1.0
-- ---------------------------------------------------------------------
create table if not exists public.alert_rules (
  id          uuid primary key default gen_random_uuid(),
  metric      text        not null check (metric in ('hhh_helpful_pct','hhh_honest_pct','hhh_harmful_pct','correction_rate_pct','openai_budget_pct','cost_per_contract_usd_max','guardrail_false_positive_rate_pct')),
  comparator  text        not null check (comparator in ('<','>','<=','>=')),
  threshold   numeric     not null,
  window_days integer     not null default 7 check (window_days between 1 and 90),
  channel     text        not null default 'slack' check (channel in ('slack','email','in_app')),
  params      jsonb       not null default '{}'::jsonb,   -- e.g. {"budget_usd": 300}
  enabled     boolean     not null default true,
  description text        not null default '',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint alert_rules_unique unique (metric, comparator, threshold)
);

drop trigger if exists set_alert_rules_updated_at on public.alert_rules;
create trigger set_alert_rules_updated_at
  before update on public.alert_rules
  for each row execute function public.set_updated_at();

-- capability: observe.alerts | status: stub | phase: v1.0
create table if not exists public.alert_events (
  id             uuid primary key default gen_random_uuid(),
  rule_id        uuid        not null references public.alert_rules(id) on delete cascade,
  metric_value   numeric     not null,
  threshold      numeric     not null,
  window_start   timestamptz not null,
  window_end     timestamptz not null,
  fired_at       timestamptz not null default now(),
  delivered      boolean     not null default false,
  delivered_at   timestamptz,
  delivery_error text
);

create index if not exists idx_alert_events_fired on public.alert_events (fired_at desc);
create index if not exists idx_alert_events_undelivered on public.alert_events (fired_at) where not delivered;

insert into public.alert_rules (metric, comparator, threshold, window_days, channel, params, description)
values
  ('hhh_helpful_pct',                  '<',  70,   7,  'slack', '{}'::jsonb,                  'helpful < 70%'),
  ('hhh_harmful_pct',                  '>',  2,    7,  'slack', '{}'::jsonb,                  'harmful > 2%'),
  ('correction_rate_pct',              '>',  12,   7,  'slack', '{}'::jsonb,                  'correction rate > 12% (prompt review)'),
  ('openai_budget_pct',                '>=', 80,   30, 'slack', '{"budget_usd": 300}'::jsonb, '80% of monthly OpenAI budget'),
  ('cost_per_contract_usd_max',        '>',  0.25, 1,  'slack', '{}'::jsonb,                  'a contract exceeded $0.25'),
  ('guardrail_false_positive_rate_pct','>',  30,   7,  'slack', '{}'::jsonb,                  'wrong guardrail triggers > 30% of reviewed')
on conflict (metric, comparator, threshold) do nothing;

-- Computes one metric over a rolling window. Returns NULL when the metric is
-- unmeasurable (e.g. fewer than 200 HHH samples) so no alert fires on it (P-5).
create or replace function public.compute_alert_metric(p_metric text, p_window_days integer, p_params jsonb default '{}'::jsonb)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  v_from timestamptz := now() - make_interval(days => p_window_days);
  v_n bigint;
  v_val numeric;
begin
  case p_metric
    when 'hhh_helpful_pct', 'hhh_honest_pct', 'hhh_harmful_pct' then
      -- same counting population as v_kpi_hhh_weekly: human rows, plus gated judge rows
      -- only for subjects with no human row (human wins)
      with gate as (
        select coalesce((select (value->>'gate_met')::boolean from public.eval_gates where key = 'judge_gate'), false) as judge_counts),
      keyed as (
        select s.*, coalesce(s.term_id::text, s.message_id::text, s.risk_flag_id::text, 'summary:' || s.contract_id::text) as subject_key
        from public.hhh_scores s where s.created_at >= v_from),
      counting as (
        select k.* from keyed k, gate
         where k.evaluator = 'human'
            or (gate.judge_counts and not exists (
                  select 1 from keyed h where h.subject_key = k.subject_key and h.evaluator = 'human')))
      select count(*),
             case p_metric
               when 'hhh_helpful_pct' then 100.0 * count(*) filter (where helpful_verdict  = 'pass') / nullif(count(*), 0)
               when 'hhh_honest_pct'  then 100.0 * count(*) filter (where honest_verdict   = 'pass') / nullif(count(*), 0)
               else                        100.0 * count(*) filter (where harmless_verdict = 'fail') / nullif(count(*), 0)
             end
        into v_n, v_val
        from counting;
      if v_n < 200 then return null; end if;
      return v_val;
    when 'correction_rate_pct' then
      select count(*) into v_n from public.key_terms where created_at >= v_from;
      if v_n = 0 then return null; end if;
      select 100.0 * count(*) filter (where is_edited) / count(*) into v_val
        from public.key_terms where created_at >= v_from;
      return v_val;
    when 'openai_budget_pct' then
      select 100.0 * coalesce(sum(cost_usd), 0) / nullif((p_params->>'budget_usd')::numeric, 0) into v_val
        from public.openai_calls
       where created_at >= date_trunc('month', now()) and purpose <> 'judge';
      return v_val;
    when 'cost_per_contract_usd_max' then
      select max(total) into v_val from (
        select o.contract_id, sum(o.cost_usd) as total
          from public.openai_calls o
          join public.contracts c on c.id = o.contract_id
         where c.created_at >= v_from and o.purpose <> 'judge'
         group by o.contract_id) t;
      return v_val;
    when 'guardrail_false_positive_rate_pct' then
      select count(*) into v_n from public.guardrail_events
       where reviewed_at >= v_from;
      if v_n = 0 then return null; end if;
      select 100.0 * count(*) filter (where false_positive) / count(*) into v_val
        from public.guardrail_events where reviewed_at >= v_from;
      return v_val;
    else
      return null;
  end case;
end;
$$;

-- Evaluates every enabled rule; inserts an alert_events row when the comparison
-- holds and no event for that rule fired in the last 24 h. Delivery is done by
-- scripts/daily-ops.ts (reads delivered = false). Returns the number fired.
create or replace function public.evaluate_alert_rules()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  v_val numeric;
  v_hit boolean;
  v_fired integer := 0;
begin
  for r in select * from public.alert_rules where enabled loop
    v_val := public.compute_alert_metric(r.metric, r.window_days, r.params);
    if v_val is null then continue; end if;
    v_hit := case r.comparator
               when '<'  then v_val <  r.threshold
               when '>'  then v_val >  r.threshold
               when '<=' then v_val <= r.threshold
               when '>=' then v_val >= r.threshold
             end;
    if v_hit and not exists (
         select 1 from public.alert_events e
          where e.rule_id = r.id and e.fired_at > now() - interval '24 hours') then
      insert into public.alert_events (rule_id, metric_value, threshold, window_start, window_end)
      values (r.id, v_val, r.threshold, now() - make_interval(days => r.window_days), now());
      v_fired := v_fired + 1;
    end if;
  end loop;
  return v_fired;
end;
$$;

revoke all on function public.compute_alert_metric(text, integer, jsonb) from public, anon, authenticated;
revoke all on function public.evaluate_alert_rules() from public, anon, authenticated;
grant execute on function public.compute_alert_metric(text, integer, jsonb) to service_role;
grant execute on function public.evaluate_alert_rules() to service_role;

select cron.unschedule('evaluate-alert-rules')
where exists (select 1 from cron.job where jobname = 'evaluate-alert-rules');
select cron.schedule('evaluate-alert-rules', '0 2 * * *', $$ select public.evaluate_alert_rules(); $$);

-- ---------------------------------------------------------------------
-- A11b. contract_chunks — present, unused (full-context is the built strategy)
-- capability: retrieval.vector | status: stub | phase: v2
-- ---------------------------------------------------------------------
create table if not exists public.contract_chunks (
  id          uuid primary key default gen_random_uuid(),
  contract_id uuid        not null references public.contracts(id) on delete cascade,
  user_id     uuid        not null references public.profiles(id) on delete cascade,
  page_number integer     not null check (page_number >= 1),
  chunk_index integer     not null check (chunk_index >= 0),
  content     text        not null,
  embedding   extensions.vector(1536),          -- unused until retrieval.vector is built
  created_at  timestamptz not null default now(),
  constraint contract_chunks_contract_index_unique unique (contract_id, chunk_index)
);

create index if not exists idx_contract_chunks_contract on public.contract_chunks (contract_id, page_number);

-- ---------------------------------------------------------------------
-- A12. KPI tree views (PRD §3) — security_invoker: owners see their own rows,
--      the service role sees the population.
-- ---------------------------------------------------------------------
-- North Star: contracts processed with review completed, week over week
drop view if exists public.v_kpi_north_star_weekly;
create or replace view public.v_kpi_north_star_weekly with (security_invoker = true) as
with reviewed as (
  select c.id, c.user_id,
         date_trunc('week', coalesce(c.review_completed_at,
           (select min(e.created_at) from public.activity_events e
             where e.contract_id = c.id and e.event_type = 'results_viewed'))) as week
  from public.contracts c
  where c.status = 'completed'
    and (c.review_completed_at is not null
         or exists (select 1 from public.activity_events e
                     where e.contract_id = c.id and e.event_type = 'results_viewed'))
),
weekly as (
  select week, count(*) as contracts_reviewed, count(distinct user_id) as active_users
  from reviewed group by week
)
select week, contracts_reviewed, active_users,
       lag(contracts_reviewed) over (order by week) as prev_week,
       round(100.0 * (contracts_reviewed - lag(contracts_reviewed) over (order by week))
             / nullif(lag(contracts_reviewed) over (order by week), 0), 1) as wow_pct
from weekly
order by week;

drop view if exists public.v_kpi_contracts_per_user_monthly;
create or replace view public.v_kpi_contracts_per_user_monthly with (security_invoker = true) as
select date_trunc('month', coalesce(c.review_completed_at, c.processed_at)) as month,
       c.user_id,
       count(*) as contracts_reviewed
from public.contracts c
where c.status = 'completed'
  and (c.review_completed_at is not null
       or exists (select 1 from public.activity_events e
                   where e.contract_id = c.id and e.event_type = 'results_viewed'))
group by 1, 2;

-- L1: time-to-clarity (upload -> review complete / last interaction), minutes
drop view if exists public.v_kpi_time_to_clarity;
create or replace view public.v_kpi_time_to_clarity with (security_invoker = true) as
select c.id as contract_id, c.user_id, date_trunc('week', c.created_at) as week,
       extract(epoch from (coalesce(c.review_completed_at,
              (select max(e.created_at) from public.activity_events e where e.contract_id = c.id))
              - c.created_at)) / 60.0 as minutes_to_clarity
from public.contracts c
where c.status = 'completed';

-- L1: task completion funnel over activity_events (>= 85% of started reviews reach review complete)
drop view if exists public.v_kpi_task_completion;
create or replace view public.v_kpi_task_completion with (security_invoker = true) as
with per_contract as (
  select c.id, c.user_id, date_trunc('week', c.created_at) as week,
         bool_or(e.event_type = 'upload_complete')  as uploaded,
         bool_or(e.event_type = 'process_started')  as started,
         bool_or(c.status = 'completed')            as processed,
         bool_or(e.event_type = 'results_viewed')   as viewed,
         bool_or(e.event_type = 'review_completed') as completed
  from public.contracts c
  left join public.activity_events e on e.contract_id = c.id
  group by c.id, c.user_id, date_trunc('week', c.created_at)
)
select week,
       count(*) filter (where uploaded)  as uploaded,
       count(*) filter (where started)   as started,
       count(*) filter (where processed) as processed,
       count(*) filter (where viewed)    as results_viewed,
       count(*) filter (where completed) as review_completed,
       round(100.0 * count(*) filter (where completed)
             / nullif(count(*) filter (where started), 0), 1) as completion_rate_pct
from per_contract
group by week
order by week;

-- L1: % helpful / % honest / % harmful per ISO week over the counting population:
--     every human row, plus llm-judge rows only while eval_gates.judge_gate.gate_met
--     AND the same subject has no human row (the judge double-scores the human sample
--     on purpose so the overlap exists; in counting the human row wins).
--     compute_alert_metric() uses the identical population. reportable = n >= 200.
drop view if exists public.v_kpi_hhh_weekly;
create or replace view public.v_kpi_hhh_weekly with (security_invoker = true) as
with gate as (
  select coalesce((select (g.value->>'gate_met')::boolean from public.eval_gates g where g.key = 'judge_gate'), false) as judge_counts
),
keyed as (
  select s.*, date_trunc('week', s.created_at) as week,
         coalesce(s.term_id::text, s.message_id::text, s.risk_flag_id::text, 'summary:' || s.contract_id::text) as subject_key
  from public.hhh_scores s
),
counting as (
  select k.* from keyed k, gate
  where k.evaluator = 'human'
     or (gate.judge_counts and not exists (
           select 1 from keyed h where h.subject_key = k.subject_key and h.evaluator = 'human'))
),
overlap as (
  select date_trunc('week', j.created_at) as week, count(*) as n_overlap
  from keyed j
  where j.evaluator = 'llm-judge'
    and exists (select 1 from keyed h where h.subject_key = j.subject_key and h.evaluator = 'human')
  group by 1
)
select c.week,
       count(*)                                          as n,
       count(*) filter (where c.evaluator = 'human')     as n_human,
       count(*) filter (where c.evaluator = 'llm-judge') as n_judge,
       coalesce(max(o.n_overlap), 0)                     as n_overlap,
       (select judge_counts from gate)                   as judge_counts,
       round(100.0 * count(*) filter (where c.helpful_verdict  = 'pass') / count(*), 1) as helpful_pct,
       round(100.0 * count(*) filter (where c.honest_verdict   = 'pass') / count(*), 1) as honest_pct,
       round(100.0 * count(*) filter (where c.harmless_verdict = 'fail') / count(*), 1) as harmful_pct,
       (count(*) >= 200)                                 as reportable
from counting c
left join overlap o on o.week = c.week
group by c.week
order by c.week;

-- L1B: cost per contract (judge spend excluded — it is eval budget)
drop view if exists public.v_kpi_cost_per_contract;
create or replace view public.v_kpi_cost_per_contract with (security_invoker = true) as
select o.contract_id, c.user_id, date_trunc('week', c.created_at) as week,
       sum(o.cost_usd)                                                              as total_usd,
       sum(o.cost_usd) filter (where o.purpose = 'extraction')                     as extraction_usd,
       sum(o.cost_usd) filter (where o.purpose = 'summary')                        as summary_usd,
       sum(o.cost_usd) filter (where o.purpose in ('chat','query_enhancer','repair')) as chat_usd,
       sum(o.cost_usd) filter (where o.purpose = 'risk')                           as risk_usd
from public.openai_calls o
join public.contracts c on c.id = o.contract_id
where o.purpose <> 'judge'
group by o.contract_id, c.user_id, date_trunc('week', c.created_at);

-- L2: correction rate per week and contract type (value edits; page/reasoning reported separately)
drop view if exists public.v_kpi_correction_rate_weekly;
create or replace view public.v_kpi_correction_rate_weekly with (security_invoker = true) as
select date_trunc('week', kt.created_at) as week, c.contract_type,
       count(*) as terms,
       round(100.0 * count(*) filter (where kt.is_edited)        / count(*), 2) as value_correction_pct,
       round(100.0 * count(*) filter (where kt.page_edited)      / count(*), 2) as page_correction_pct,
       round(100.0 * count(*) filter (where kt.reasoning_edited) / count(*), 2) as reasoning_correction_pct
from public.key_terms kt
join public.contracts c on c.id = kt.contract_id
group by 1, 2
order by 1, 2;

-- Error rate per component (processing_runs.stage names the component)
drop view if exists public.v_error_rate_by_component;
create or replace view public.v_error_rate_by_component with (security_invoker = true) as
select date_trunc('week', created_at) as week, stage,
       count(*) as runs,
       count(*) filter (where outcome = 'error') as errors,
       round(100.0 * count(*) filter (where outcome = 'error') / count(*), 2) as error_rate_pct,
       mode() within group (order by error_code) as top_error_code
from public.processing_runs
group by 1, 2
order by 1, 2;

-- Intent resolution: query classes, unresolved-turn rate, escalation rate
drop view if exists public.v_intent_resolution;
create or replace view public.v_intent_resolution with (security_invoker = true) as
with turns as (
  select date_trunc('week', m.created_at) as week, m.query_class, m.session_id
  from public.chat_messages m where m.role = 'assistant'
),
unresolved as (
  select date_trunc('week', e.created_at) as week,
         count(*) as sent,
         count(*) filter (where coalesce((e.metadata->>'unresolved_turns')::integer, 0) >= 3) as unresolved_3plus
  from public.activity_events e where e.event_type = 'chat_message_sent'
  group by 1
)
select t.week,
       count(*) filter (where t.query_class = 'contract') as contract_turns,
       count(*) filter (where t.query_class = 'history')  as history_turns,
       count(*) filter (where t.query_class = 'both')     as both_turns,
       count(*) filter (where t.query_class is null)      as guardrail_turns,
       round(100.0 * coalesce(max(u.unresolved_3plus), 0) / nullif(max(u.sent), 0), 2) as unresolved_turn_rate_pct,
       round(100.0 * (select count(*) from public.escalations x where date_trunc('week', x.created_at) = t.week)
             / nullif(count(distinct t.session_id), 0), 2) as escalation_rate_pct
from turns t
left join unresolved u on u.week = t.week
group by t.week
order by t.week;

-- Content safety: guardrail firings + HHH harmless failures per week
drop view if exists public.v_content_safety_weekly;
create or replace view public.v_content_safety_weekly with (security_invoker = true) as
select w.week,
       (select count(*) from public.guardrail_events g where date_trunc('week', g.created_at) = w.week and g.action = 'block')   as blocked,
       (select count(*) from public.guardrail_events g where date_trunc('week', g.created_at) = w.week and g.action = 'rewrite') as rewritten,
       (select count(*) from public.guardrail_events g where date_trunc('week', g.created_at) = w.week and g.action = 'flag')    as flagged,
       (select round(100.0 * count(*) filter (where s.harmless_verdict = 'fail') / nullif(count(*), 0), 2)
          from public.hhh_scores s where date_trunc('week', s.created_at) = w.week) as harmful_pct
from (select distinct date_trunc('week', created_at) as week from public.guardrail_events
      union select distinct date_trunc('week', created_at) from public.hhh_scores) w
order by w.week;

-- Wrong guardrail triggers: false-positive rate among reviewed events, per rule
drop view if exists public.v_guardrail_false_positive_rate;
create or replace view public.v_guardrail_false_positive_rate with (security_invoker = true) as
select rule,
       count(*) filter (where reviewed_at is not null) as reviewed,
       count(*) filter (where false_positive)          as false_positives,
       round(100.0 * count(*) filter (where false_positive)
             / nullif(count(*) filter (where reviewed_at is not null), 0), 2) as false_positive_rate_pct
from public.guardrail_events
group by rule;

-- ---------------------------------------------------------------------
-- A14. Row Level Security — enabled on EVERY new table, with policies
-- ---------------------------------------------------------------------
alter table public.playbooks          enable row level security;
alter table public.playbook_rules     enable row level security;
alter table public.risk_flags         enable row level security;
alter table public.escalations        enable row level security;
alter table public.integration_connections enable row level security;
alter table public.integration_events enable row level security;
alter table public.key_dates          enable row level security;
alter table public.reminders          enable row level security;
alter table public.hhh_scores         enable row level security;
alter table public.guardrail_events   enable row level security;
alter table public.alert_rules        enable row level security;   -- no policies: operator only
alter table public.alert_events       enable row level security;   -- no policies: operator only
alter table public.contract_chunks    enable row level security;
alter table public.eval_gates         enable row level security;

-- playbooks: own, plus the seeded default (user_id is null) readable by everyone
drop policy if exists playbooks_select_own_or_default on public.playbooks;
create policy playbooks_select_own_or_default on public.playbooks
  for select to authenticated using (user_id = auth.uid() or user_id is null);
drop policy if exists playbooks_insert_own on public.playbooks;
create policy playbooks_insert_own on public.playbooks
  for insert to authenticated with check (user_id = auth.uid());
drop policy if exists playbooks_update_own on public.playbooks;
create policy playbooks_update_own on public.playbooks
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists playbooks_delete_own on public.playbooks;
create policy playbooks_delete_own on public.playbooks
  for delete to authenticated using (user_id = auth.uid());

-- playbook_rules: own or seed readable; own insert/delete; never updated in place
drop policy if exists playbook_rules_select_own_or_default on public.playbook_rules;
create policy playbook_rules_select_own_or_default on public.playbook_rules
  for select to authenticated using (user_id = auth.uid() or user_id is null);
drop policy if exists playbook_rules_insert_own on public.playbook_rules;
create policy playbook_rules_insert_own on public.playbook_rules
  for insert to authenticated with check (user_id = auth.uid());
drop policy if exists playbook_rules_delete_own on public.playbook_rules;
create policy playbook_rules_delete_own on public.playbook_rules
  for delete to authenticated using (user_id = auth.uid());

-- risk_flags: own select/insert/update (decision, was_wrong); no delete
drop policy if exists risk_flags_select_own on public.risk_flags;
create policy risk_flags_select_own on public.risk_flags
  for select to authenticated using (user_id = auth.uid());
drop policy if exists risk_flags_insert_own on public.risk_flags;
create policy risk_flags_insert_own on public.risk_flags
  for insert to authenticated with check (user_id = auth.uid());
drop policy if exists risk_flags_update_own on public.risk_flags;
create policy risk_flags_update_own on public.risk_flags
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- escalations: own select/insert; closing is service-role only (no update policy)
drop policy if exists escalations_select_own on public.escalations;
create policy escalations_select_own on public.escalations
  for select to authenticated using (user_id = auth.uid());
drop policy if exists escalations_insert_own on public.escalations;
create policy escalations_insert_own on public.escalations
  for insert to authenticated with check (user_id = auth.uid());

-- integration_connections: own select/delete; insert/update are service-role only (OAuth callback)
drop policy if exists integration_connections_select_own on public.integration_connections;
create policy integration_connections_select_own on public.integration_connections
  for select to authenticated using (user_id = auth.uid());
drop policy if exists integration_connections_delete_own on public.integration_connections;
create policy integration_connections_delete_own on public.integration_connections
  for delete to authenticated using (user_id = auth.uid());

-- integration_events: own select/insert
drop policy if exists integration_events_select_own on public.integration_events;
create policy integration_events_select_own on public.integration_events
  for select to authenticated using (user_id = auth.uid());
drop policy if exists integration_events_insert_own on public.integration_events;
create policy integration_events_insert_own on public.integration_events
  for insert to authenticated with check (user_id = auth.uid());

-- key_dates / reminders: full owner CRUD
drop policy if exists key_dates_select_own on public.key_dates;
create policy key_dates_select_own on public.key_dates
  for select to authenticated using (user_id = auth.uid());
drop policy if exists key_dates_insert_own on public.key_dates;
create policy key_dates_insert_own on public.key_dates
  for insert to authenticated with check (user_id = auth.uid());
drop policy if exists key_dates_update_own on public.key_dates;
create policy key_dates_update_own on public.key_dates
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists key_dates_delete_own on public.key_dates;
create policy key_dates_delete_own on public.key_dates
  for delete to authenticated using (user_id = auth.uid());

drop policy if exists reminders_select_own on public.reminders;
create policy reminders_select_own on public.reminders
  for select to authenticated using (user_id = auth.uid());
drop policy if exists reminders_insert_own on public.reminders;
create policy reminders_insert_own on public.reminders
  for insert to authenticated with check (user_id = auth.uid());
drop policy if exists reminders_update_own on public.reminders;
create policy reminders_update_own on public.reminders
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists reminders_delete_own on public.reminders;
create policy reminders_delete_own on public.reminders
  for delete to authenticated using (user_id = auth.uid());

-- hhh_scores: own select/insert/update; no delete
drop policy if exists hhh_scores_select_own on public.hhh_scores;
create policy hhh_scores_select_own on public.hhh_scores
  for select to authenticated using (user_id = auth.uid());
-- insert/update only rows the caller authored (created_by): SME rows (created_by = operator)
-- and judge rows on a user's contracts are readable by the owner but immutable to them.
-- G40: and only on the caller's own contract — user_id = auth.uid() alone let an account
-- attach a score to another account's contract_id.
drop policy if exists hhh_scores_insert_own on public.hhh_scores;
create policy hhh_scores_insert_own on public.hhh_scores
  for insert to authenticated with check (
    user_id = auth.uid() and created_by = auth.uid()
    and exists (select 1 from public.contracts c where c.id = contract_id and c.user_id = auth.uid()));
drop policy if exists hhh_scores_update_own on public.hhh_scores;
create policy hhh_scores_update_own on public.hhh_scores
  for update to authenticated
  using (user_id = auth.uid() and created_by = auth.uid())
  with check (
    user_id = auth.uid() and created_by = auth.uid()
    and exists (select 1 from public.contracts c where c.id = contract_id and c.user_id = auth.uid()));

-- guardrail_events: own select/insert; false_positive is an operator write (no update policy)
drop policy if exists guardrail_events_select_own on public.guardrail_events;
create policy guardrail_events_select_own on public.guardrail_events
  for select to authenticated using (user_id = auth.uid());
drop policy if exists guardrail_events_insert_own on public.guardrail_events;
create policy guardrail_events_insert_own on public.guardrail_events
  for insert to authenticated with check (user_id = auth.uid());

-- alert_rules / alert_events: no client access at all
revoke all on table public.alert_rules  from anon, authenticated;
revoke all on table public.alert_events from anon, authenticated;

-- contract_chunks: own select/insert/delete
drop policy if exists contract_chunks_select_own on public.contract_chunks;
create policy contract_chunks_select_own on public.contract_chunks
  for select to authenticated using (user_id = auth.uid());
drop policy if exists contract_chunks_insert_own on public.contract_chunks;
create policy contract_chunks_insert_own on public.contract_chunks
  for insert to authenticated with check (user_id = auth.uid());
drop policy if exists contract_chunks_delete_own on public.contract_chunks;
create policy contract_chunks_delete_own on public.contract_chunks
  for delete to authenticated using (user_id = auth.uid());

-- eval_gates: readable by any authenticated user (no user data); writes service-role only
drop policy if exists eval_gates_select_all on public.eval_gates;
create policy eval_gates_select_all on public.eval_gates
  for select to authenticated using (true);

-- =====================================================================
-- End of v1.1 additions.
-- Verification after running:
--   1) select count(*) from pg_tables where schemaname='public';  -- 28 tables
--   2) select tablename, rowsecurity from pg_tables where schemaname='public';  -- all true
--   3) select jobname from cron.job;  -- purge-expired-pdfs, reclaim-stale-processing, evaluate-alert-rules, mark-due-reminders
--   4) select extname from pg_extension where extname = 'vector';  -- 1 row
--   5) select rule_key from public.playbook_rules where playbook_id = '00000000-0000-0000-0000-00000000a001';  -- 5 rows
--   6) select metric from public.alert_rules;  -- 6 rows
--   7) select table_name from information_schema.views where table_schema='public';  -- 13 views
-- =====================================================================
