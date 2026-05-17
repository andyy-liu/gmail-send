-- Add per-recipient parent thread metadata so scheduled follow-ups can call
-- gmail.users.messages.send with the parent threadId and In-Reply-To header,
-- preserving the reply thread instead of starting a new conversation.
--
-- Apply this in the Supabase SQL editor after the initial schema.sql.

alter table public.send_recipients
  add column if not exists parent_thread_id text,
  add column if not exists parent_mime_message_id text;
