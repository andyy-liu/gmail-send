-- Allow test follow-ups shorter than one hour, e.g. 0.1 hours = 6 minutes.

alter table public.batches
  alter column scheduled_delay_value type numeric
  using scheduled_delay_value::numeric;
