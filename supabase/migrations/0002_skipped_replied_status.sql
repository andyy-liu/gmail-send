-- Add 'skipped_replied' to send_recipient_status so the scheduler can mark
-- follow-up recipients that already replied to the parent thread. These rows
-- are not failures and should not be retried.
--
-- Apply this in the Supabase SQL editor after 0001_reply_fields.sql.

alter type public.send_recipient_status add value if not exists 'skipped_replied';

-- Also update schema.sql in the repo for greenfield installs.
