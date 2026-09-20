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
