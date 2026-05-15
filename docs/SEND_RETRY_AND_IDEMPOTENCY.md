# Send Retry And Idempotency Policy

This document defines how Gmail Send should behave when a send fails or when a worker is interrupted. The goal is to avoid duplicate emails while still retrying temporary failures.

## Terms

### Transient failure

A failure that may succeed later without user edits.

Examples:

- Gmail rate limit: HTTP 429.
- Gmail server errors: HTTP 500, 502, 503, 504.
- Network timeout.
- Temporary token refresh failure.

Recommended behavior:

- Retry automatically.

### Permanent failure

A failure that should not succeed later unless the user changes something.

Examples:

- Invalid email address.
- Header or payload validation failure.
- Gmail 400 validation error.
- Gmail 401/403 after refresh-token renewal fails.

Recommended behavior:

- Do not retry automatically.
- Mark the recipient failed and show the error to the user.

## Recommended retry policy

Use 2 total attempts per recipient:

1. Initial attempt at the scheduled time.
2. Retry 1 after 5 minutes.
3. Retry 2 after 30 minutes.

After the second retry fails, mark the recipient as `failed`.

Why this is the right default:

- It is conservative with Gmail rate limits.
- It gives short outages time to recover.
- It is easy to explain in the UI.
- It prevents bad data from retrying forever.

## Idempotency

Idempotency means the app can safely retry processing without sending the same recipient duplicate emails.

The core rule:

> One `send_recipients` row should produce at most one successful Gmail message.

Required behavior:

- Each recipient gets a unique `idempotency_key`.
- Before sending, the worker checks whether `gmail_message_id` already exists.
- If `gmail_message_id` exists, skip sending.
- After Gmail accepts a message, immediately save `gmail_message_id`, `gmail_thread_id`, and `gmail_mime_message_id`.
- Never retry a recipient whose status is `sent`.

Important limitation:

- Gmail's send API does not give true server-side idempotency. The app must enforce it with its own database state.
- If the process crashes after Gmail sends but before the database stores the Gmail message ID, a duplicate is still possible.

Best mitigation:

- Keep the send-and-persist block as small as possible.
- Store result metadata immediately after Gmail returns.
- Use a stable `Message-ID` header so duplicates are easier to detect later if needed.

## Worker flow

1. Claim due jobs by setting `send_jobs.status = 'running'`, `locked_at`, and `locked_by`.
2. Load pending recipients for the job.
3. For each recipient:
   - Skip if already `sent`.
   - Mark as `sending`.
   - Send through Gmail.
   - Persist Gmail IDs immediately on success.
   - On failure, classify as transient or permanent.
4. For transient failures:
   - Increment `attempts`.
   - Set `next_attempt_at`.
   - Return status to `pending`.
5. For permanent failures:
   - Increment `attempts`.
   - Mark status `failed`.
6. Finalize the job:
   - `completed` if all recipients sent.
   - `partial_failed` if any recipients are still retryable.
   - `failed` if all remaining failures are terminal.

## UI behavior

Show these states clearly:

- `Scheduled`: job is pending.
- `Sending`: worker is currently processing.
- `Sent`: every recipient succeeded.
- `Partial failed`: some recipients succeeded and some failed or are retrying.
- `Failed`: no more automatic retries are pending.
- `Cancelled`: user cancelled before send completion.

For `partial_failed`, show per-recipient status and error text.
