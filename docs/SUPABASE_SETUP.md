# Supabase Setup

This setup assumes Gmail Send remains a NextAuth app and uses Supabase from server-side Next.js routes only. Do not expose the Supabase service-role key to browser code.

## 1. Create the Supabase project

1. Create a Supabase project.
2. Open **SQL Editor**.
3. Paste and run `supabase/schema.sql`.
4. Confirm the tables exist under the `public` schema.

The schema enables Row Level Security and revokes table access from `anon` and `authenticated`. The app will use `SUPABASE_SERVICE_ROLE_KEY` from trusted server code, then enforce ownership by `app_users.id` in application logic.

## 2. Add environment variables

Add these to `.env.local` and to the production hosting environment:

```bash
SUPABASE_URL=...
SUPABASE_SERVICE_ROLE_KEY=...

# 32 random bytes, base64 encoded.
# Generate with: openssl rand -base64 32
GOOGLE_TOKEN_ENCRYPTION_KEY=...
GOOGLE_TOKEN_ENCRYPTION_KEY_VERSION=1
```

Keep existing Google and NextAuth variables:

```bash
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
NEXTAUTH_URL=...
NEXTAUTH_SECRET=...
```

Do not prefix the service-role key or encryption key with `NEXT_PUBLIC_`.

## 3. Credential storage approach

Use app-side encryption for Google refresh tokens:

1. When Google returns a refresh token, encrypt it on the server with `GOOGLE_TOKEN_ENCRYPTION_KEY`.
2. Store the encrypted pieces in `google_accounts.refresh_token_ciphertext`, `refresh_token_iv`, and `refresh_token_tag`.
3. Store `refresh_token_key_version`.
4. Decrypt only inside server routes or worker code that needs to refresh Gmail access.

Recommended encryption primitive:

- AES-256-GCM.
- Random 12-byte IV per token.
- Auth tag stored separately.
- `GOOGLE_TOKEN_ENCRYPTION_KEY` decoded from base64 to exactly 32 bytes.

This is simpler than introducing an external secret manager and is appropriate for a small internal tool, as long as the app server environment is locked down.

## 4. Ownership model

Every data table has `user_id`.

Required application behavior:

- On sign-in, upsert `app_users` by Google email or Google subject.
- On every read/write, resolve the current NextAuth session to an `app_users.id`.
- Every query must filter by that `user_id`.
- Never accept `user_id` from the browser.
- Scheduled job workers must use the job's stored `user_id` and `google_account_id`, not request input.

## 5. Scheduled send model

Use these tables for scheduled sends:

- `send_jobs`: one row per send action.
- `send_recipients`: one row per recipient inside that job.

Important fields:

- `send_jobs.status`: overall job state.
- `send_recipients.status`: per-recipient state.
- `send_recipients.idempotency_key`: prevents duplicate sends.
- `send_recipients.gmail_message_id`, `gmail_thread_id`, `gmail_mime_message_id`: proof that Gmail accepted the send.

Do not delete jobs after they run. Mark them completed or failed so there is an audit trail.

## 6. Worker requirement

For production, scheduled sends need a real worker or cron trigger. Do not rely on a Next.js module-level `setInterval`.

Smallest acceptable production setup:

- A scheduled cron job runs every minute.
- It calls a protected server endpoint, for example `/api/jobs/process`.
- The endpoint claims due jobs with row updates and processes recipients.
- Only one worker should claim a job at a time using `locked_at` and `locked_by`.

Future improvement:

- Move processing into a dedicated worker process or managed queue.

## 7. Query patterns

Create or find the current app user:

```sql
insert into public.app_users (google_sub, email, name, image_url)
values (:google_sub, :email, :name, :image_url)
on conflict (email)
do update set
  google_sub = coalesce(excluded.google_sub, public.app_users.google_sub),
  name = excluded.name,
  image_url = excluded.image_url
returning *;
```

Store an encrypted Google refresh token:

```sql
insert into public.google_accounts (
  user_id,
  google_sub,
  email,
  refresh_token_ciphertext,
  refresh_token_iv,
  refresh_token_tag,
  refresh_token_key_version,
  scopes
)
values (
  :user_id,
  :google_sub,
  :email,
  :ciphertext,
  :iv,
  :tag,
  :key_version,
  :scopes
)
on conflict (user_id, email)
do update set
  google_sub = excluded.google_sub,
  refresh_token_ciphertext = coalesce(excluded.refresh_token_ciphertext, public.google_accounts.refresh_token_ciphertext),
  refresh_token_iv = coalesce(excluded.refresh_token_iv, public.google_accounts.refresh_token_iv),
  refresh_token_tag = coalesce(excluded.refresh_token_tag, public.google_accounts.refresh_token_tag),
  refresh_token_key_version = excluded.refresh_token_key_version,
  scopes = excluded.scopes
returning *;
```

Create a scheduled send job:

```sql
insert into public.send_jobs (
  user_id,
  batch_id,
  google_account_id,
  kind,
  status,
  scheduled_at,
  idempotency_key
)
values (
  :user_id,
  :batch_id,
  :google_account_id,
  'scheduled_send',
  'pending',
  :scheduled_at,
  :job_idempotency_key
)
returning *;
```

Create one recipient row per contact:

```sql
insert into public.send_recipients (
  user_id,
  job_id,
  contact_id,
  email,
  first_name,
  company,
  status,
  next_attempt_at,
  idempotency_key
)
select
  :user_id,
  :job_id,
  c.id,
  c.email,
  c.first_name,
  c.company,
  'pending',
  :scheduled_at,
  :recipient_idempotency_prefix || ':' || c.id::text
from public.contacts c
where c.batch_id = :batch_id
  and c.user_id = :user_id;
```

Claim due jobs:

```sql
update public.send_jobs
set
  status = 'running',
  locked_at = now(),
  locked_by = :worker_id,
  started_at = coalesce(started_at, now())
where id in (
  select id
  from public.send_jobs
  where status in ('pending', 'partial_failed')
    and scheduled_at <= now()
    and (locked_at is null or locked_at < now() - interval '5 minutes')
  order by scheduled_at asc
  limit :limit
  for update skip locked
)
returning *;
```

Mark a recipient sent:

```sql
update public.send_recipients
set
  status = 'sent',
  sent_at = now(),
  gmail_message_id = :gmail_message_id,
  gmail_thread_id = :gmail_thread_id,
  gmail_mime_message_id = :gmail_mime_message_id,
  last_error = null,
  last_error_at = null
where id = :send_recipient_id
  and user_id = :user_id
  and status <> 'sent'
returning *;
```

Mark a transient recipient failure for retry:

```sql
update public.send_recipients
set
  status = 'pending',
  attempts = attempts + 1,
  next_attempt_at = :next_attempt_at,
  last_error = :error_message,
  last_error_at = now()
where id = :send_recipient_id
  and user_id = :user_id
  and status <> 'sent'
returning *;
```

Mark a terminal recipient failure:

```sql
update public.send_recipients
set
  status = 'failed',
  attempts = attempts + 1,
  next_attempt_at = null,
  last_error = :error_message,
  last_error_at = now()
where id = :send_recipient_id
  and user_id = :user_id
  and status <> 'sent'
returning *;
```

Finalize a job after processing recipients:

```sql
update public.send_jobs j
set
  status = case
    when stats.failed_count = 0 and stats.pending_count = 0 then 'completed'::public.send_job_status
    when stats.pending_count > 0 then 'partial_failed'::public.send_job_status
    else 'failed'::public.send_job_status
  end,
  completed_at = case
    when stats.pending_count = 0 then now()
    else j.completed_at
  end,
  locked_at = null,
  locked_by = null
from (
  select
    job_id,
    count(*) filter (where status = 'failed') as failed_count,
    count(*) filter (where status in ('pending', 'sending')) as pending_count
  from public.send_recipients
  where job_id = :job_id
  group by job_id
) stats
where j.id = stats.job_id
returning j.*;
```

## 8. Recommended retry policy

Use 3 total attempts per recipient:

1. First retry after 5 minutes.
2. Second retry after 30 minutes.
3. Third retry after 2 hours.

Retry only transient failures:

- Gmail 429 rate limit.
- Gmail 500/502/503/504.
- Network timeout.
- Temporary token refresh failure.

Do not retry permanent failures:

- Invalid email address.
- Gmail 400 validation errors.
- Gmail 401/403 after token refresh fails.
- Payload/header validation failure.

Why this policy:

- It avoids duplicate pressure on Gmail.
- It gives transient outages time to clear.
- It does not repeatedly attempt bad recipient data.
- It is simple enough to reason about and test.

## 9. References

- Supabase Row Level Security: https://supabase.com/docs/guides/database/postgres/row-level-security
- Supabase securing data guide: https://supabase.com/docs/guides/database/secure-data/
- Supabase Vault, if this later needs managed database-side secrets: https://supabase.com/docs/guides/database/vault/
