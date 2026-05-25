-- Add 'manually_stopped' to send_recipient_status so individual recipients
-- can be removed from an active sequence without waiting for a reply.
--
-- Apply this in the Supabase SQL editor after 0006_rename_custom_variable_rpc.sql.

alter type public.send_recipient_status add value if not exists 'manually_stopped';

-- Also update schema.sql in the repo for greenfield installs.
