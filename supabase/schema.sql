-- Gmail Send production schema for Supabase.
--
-- Assumptions:
-- - The Next.js server owns all Supabase reads/writes using SUPABASE_SERVICE_ROLE_KEY.
-- - Browser code does not talk directly to Supabase.
-- - Google refresh tokens are encrypted in the app before being stored here.
-- - Owner checks are enforced in application code using app_users.id on every row.

create extension if not exists "pgcrypto";
create extension if not exists "citext";

create type public.batch_status as enum (
  'draft',
  'drafted',
  'scheduled',
  'sending',
  'sent',
  'partial_failed',
  'failed',
  'cancelled'
);

create type public.send_job_status as enum (
  'pending',
  'running',
  'completed',
  'partial_failed',
  'failed',
  'cancelled'
);

create type public.send_recipient_status as enum (
  'pending',
  'sending',
  'sent',
  'failed',
  'cancelled'
);

create type public.send_job_kind as enum (
  'send_now',
  'scheduled_send',
  'follow_up'
);

create type public.email_artifact_kind as enum (
  'draft',
  'sent_message'
);

create table public.app_users (
  id uuid primary key default gen_random_uuid(),
  google_sub text unique,
  email citext not null unique,
  name text,
  image_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.google_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.app_users(id) on delete cascade,
  google_sub text,
  email citext not null,
  refresh_token_ciphertext text,
  refresh_token_iv text,
  refresh_token_tag text,
  refresh_token_key_version integer not null default 1,
  scopes text[] not null default '{}',
  token_expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, email)
);

create table public.campaigns (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.app_users(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.batches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.app_users(id) on delete cascade,
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  parent_batch_id uuid references public.batches(id) on delete set null,
  name text not null,
  subject text not null default '',
  body_html text not null default '',
  signature_html text not null default '',
  status public.batch_status not null default 'draft',
  scheduled_at timestamptz,
  scheduled_delay_value integer,
  scheduled_delay_unit text check (scheduled_delay_unit in ('hours', 'days')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  sent_at timestamptz,
  cancelled_at timestamptz,
  check (
    (scheduled_delay_value is null and scheduled_delay_unit is null)
    or (scheduled_delay_value is not null and scheduled_delay_value > 0 and scheduled_delay_unit is not null)
  )
);

create table public.contacts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.app_users(id) on delete cascade,
  batch_id uuid not null references public.batches(id) on delete cascade,
  email citext not null,
  first_name text not null,
  company text not null,
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.send_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.app_users(id) on delete cascade,
  batch_id uuid not null references public.batches(id) on delete cascade,
  google_account_id uuid not null references public.google_accounts(id) on delete restrict,
  kind public.send_job_kind not null,
  status public.send_job_status not null default 'pending',
  scheduled_at timestamptz not null,
  started_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz,
  locked_at timestamptz,
  locked_by text,
  max_attempts integer not null default 3 check (max_attempts > 0),
  idempotency_key text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.send_recipients (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.app_users(id) on delete cascade,
  job_id uuid not null references public.send_jobs(id) on delete cascade,
  contact_id uuid references public.contacts(id) on delete set null,
  email citext not null,
  first_name text not null,
  company text not null,
  status public.send_recipient_status not null default 'pending',
  attempts integer not null default 0 check (attempts >= 0),
  next_attempt_at timestamptz,
  last_error text,
  last_error_at timestamptz,
  gmail_message_id text,
  gmail_thread_id text,
  gmail_mime_message_id text,
  parent_thread_id text,
  parent_mime_message_id text,
  idempotency_key text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  sent_at timestamptz,
  check (
    (status <> 'sent')
    or (gmail_message_id is not null and gmail_thread_id is not null and gmail_mime_message_id is not null)
  )
);

create table public.email_artifacts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.app_users(id) on delete cascade,
  batch_id uuid not null references public.batches(id) on delete cascade,
  contact_id uuid references public.contacts(id) on delete set null,
  kind public.email_artifact_kind not null,
  email citext not null,
  gmail_draft_id text,
  gmail_message_id text,
  gmail_thread_id text,
  gmail_mime_message_id text,
  created_at timestamptz not null default now(),
  check (
    (kind = 'draft' and gmail_draft_id is not null)
    or (
      kind = 'sent_message'
      and gmail_message_id is not null
      and gmail_thread_id is not null
      and gmail_mime_message_id is not null
    )
  )
);

create index app_users_email_idx on public.app_users(email);
create index google_accounts_user_id_idx on public.google_accounts(user_id);
create index campaigns_user_id_idx on public.campaigns(user_id);
create index batches_user_id_idx on public.batches(user_id);
create index batches_campaign_id_idx on public.batches(campaign_id);
create index contacts_batch_id_idx on public.contacts(batch_id);
create index send_jobs_due_idx on public.send_jobs(status, scheduled_at)
  where status in ('pending', 'partial_failed');
create index send_jobs_user_id_idx on public.send_jobs(user_id);
create index send_recipients_job_status_idx on public.send_recipients(job_id, status);
create index send_recipients_next_attempt_idx on public.send_recipients(status, next_attempt_at)
  where status in ('pending', 'failed');
create index email_artifacts_batch_id_idx on public.email_artifacts(batch_id);

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger app_users_touch_updated_at
before update on public.app_users
for each row execute function public.touch_updated_at();

create trigger google_accounts_touch_updated_at
before update on public.google_accounts
for each row execute function public.touch_updated_at();

create trigger campaigns_touch_updated_at
before update on public.campaigns
for each row execute function public.touch_updated_at();

create trigger batches_touch_updated_at
before update on public.batches
for each row execute function public.touch_updated_at();

create trigger contacts_touch_updated_at
before update on public.contacts
for each row execute function public.touch_updated_at();

create trigger send_jobs_touch_updated_at
before update on public.send_jobs
for each row execute function public.touch_updated_at();

create trigger send_recipients_touch_updated_at
before update on public.send_recipients
for each row execute function public.touch_updated_at();

alter table public.app_users enable row level security;
alter table public.google_accounts enable row level security;
alter table public.campaigns enable row level security;
alter table public.batches enable row level security;
alter table public.contacts enable row level security;
alter table public.send_jobs enable row level security;
alter table public.send_recipients enable row level security;
alter table public.email_artifacts enable row level security;

-- This app should use Supabase only from trusted server code.
-- Keep anon/authenticated table access closed unless the app later adopts Supabase Auth.
revoke all on table
  public.app_users,
  public.google_accounts,
  public.campaigns,
  public.batches,
  public.contacts,
  public.send_jobs,
  public.send_recipients,
  public.email_artifacts
from anon, authenticated;

grant select, insert, update, delete on table
  public.app_users,
  public.google_accounts,
  public.campaigns,
  public.batches,
  public.contacts,
  public.send_jobs,
  public.send_recipients,
  public.email_artifacts
to service_role;

