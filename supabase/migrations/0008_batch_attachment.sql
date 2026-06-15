alter table public.batches
  add column if not exists attachment jsonb;
