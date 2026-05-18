-- Custom per-user template variables, e.g. {{Year}}, {{Role}}.
-- Values live alongside contacts in a jsonb keyed by variable name.

create table if not exists public.custom_variables (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.app_users(id) on delete cascade,
  name text not null,
  enabled boolean not null default true,
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, name)
);

create index if not exists custom_variables_user_id_idx
  on public.custom_variables(user_id);

create trigger custom_variables_touch_updated_at
before update on public.custom_variables
for each row execute function public.touch_updated_at();

alter table public.custom_variables enable row level security;

revoke all on table public.custom_variables from anon, authenticated;
grant select, insert, update, delete on table public.custom_variables to service_role;

alter table public.contacts
  add column if not exists custom_fields jsonb not null default '{}'::jsonb;

alter table public.send_recipients
  add column if not exists custom_fields jsonb not null default '{}'::jsonb;
