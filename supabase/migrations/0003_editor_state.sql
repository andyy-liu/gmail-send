-- Make campaigns/batches the source of truth for the editor (not localStorage).
-- Adds the few fields the in-memory Batch model has that the schema didn't:
--   * app_users.signature_html — per-user signature
--   * batches.recipient_results — per-recipient outcomes for non-scheduled sends
--   * batches.scheduled_job_id — link to the send_jobs row, used by the UI poll
--
-- Apply this in the Supabase SQL editor after 0002_skipped_replied_status.sql.

alter table public.app_users
  add column if not exists signature_html text not null default '';

alter table public.batches
  add column if not exists recipient_results jsonb,
  add column if not exists scheduled_job_id uuid references public.send_jobs(id) on delete set null;
