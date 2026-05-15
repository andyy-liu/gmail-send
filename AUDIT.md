# Gmail Send Codebase Audit

Date: 2026-05-15

This audit focuses on architecture, implementation quality, security, and edge cases for an app that creates drafts and sends email through Gmail. Because sending email is irreversible, the highest priority issues are the ones that can cause unauthorized access, duplicate sends, missed sends, malformed messages, or accidental immediate sends.

## Findings

### 1. Critical: scheduled jobs are global across all users

Any authenticated user can list or delete every scheduled send because scheduled jobs do not store an owner and the API only checks that a session exists.

Relevant code:
- `src/app/api/send/schedule/route.ts`
- `src/lib/scheduler.ts`

Impact:
- One user can see another user's scheduled recipients and subjects.
- One user can cancel another user's scheduled sends.
- The app cannot safely support more than one authenticated user.

Recommended fix:
- Store an owner identity on every scheduled job, ideally the authenticated user's stable Google account ID or email.
- Filter `GET`, `DELETE`, and processing APIs by owner.
- Reject deletion attempts for jobs not owned by the current user.

### 2. Critical: refresh tokens are stored plaintext on disk

Scheduled jobs persist `refreshToken` directly into `data/scheduled-jobs.json`.

Relevant code:
- `src/lib/scheduler.ts`
- `src/app/api/send/schedule/route.ts`

Impact:
- A local file compromise exposes long-lived Google account access.
- The token is outside NextAuth's normal JWT/session handling.
- The file is gitignored, but gitignore is not a security boundary.

Recommended fix:
- Avoid storing refresh tokens in scheduled job records.
- Prefer a durable authenticated account store with encryption at rest.
- If this remains a local-only app, encrypt scheduled-job secrets with a server-side key and restrict file permissions.

### 3. Critical: scheduled sending is not reliable or idempotent

Scheduling uses module import side effects, `setInterval`, and a flat JSON file. There is no lock, send state, per-recipient status, or idempotency key.

Relevant code:
- `src/lib/scheduler.ts`

Impact:
- Multiple server processes can send the same job more than once.
- Serverless deployments may not keep the interval alive.
- Restarts during a send can leave state ambiguous.
- JSON read/write races can lose jobs.

Recommended fix:
- Replace the in-process scheduler with durable storage and a single worker/queue.
- Track job state and per-recipient state: `pending`, `sending`, `sent`, `failed`, `cancelled`.
- Add idempotency keys per recipient send attempt.
- Persist Gmail response IDs immediately after each successful send.

### 4. Critical: partial scheduled-send failures are silently dropped

If some recipients fail inside a scheduled job, errors are logged but the job is still removed from storage.

Relevant code:
- `src/lib/scheduler.ts`

Impact:
- Failed recipients are never retried.
- The UI has no record of partial failure.
- Users may believe all scheduled email was sent successfully.

Recommended fix:
- Persist per-recipient results.
- Keep failed recipients retryable.
- Surface partial failure status in the UI.
- Define retry policy and terminal failure behavior.

### 5. High: backend trusts raw recipient and header fields

`To`, `From`, `In-Reply-To`, and `References` are interpolated directly into MIME headers without backend validation or CRLF stripping.

Relevant code:
- `src/lib/gmail.ts`
- `src/app/api/send/now/route.ts`
- `src/app/api/drafts/create/route.ts`
- `src/app/api/send/schedule/route.ts`

Impact:
- Invalid email addresses can be submitted.
- Header injection is possible if an attacker can submit strings containing newline characters.
- Malformed messages can be sent or rejected unpredictably.

Recommended fix:
- Add server-side validation for contacts and template payloads.
- Normalize and validate email addresses before constructing MIME.
- Reject strings containing CR/LF in all header-bound values.
- Validate `threadId` and `Message-ID` inputs before using them in reply headers.

### 6. High: `Send Now` is the default and has no final confirmation

The drawer defaults to immediate send and the primary action directly submits the irreversible operation.

Relevant code:
- `src/components/NodeDrawer.tsx`
- `src/hooks/useEmailSend.ts`

Impact:
- Users can accidentally send real email with one click.
- There is no final preview of recipient count, recipients, subject, body, or signature.

Recommended fix:
- Default to draft creation, not immediate send.
- Add a final confirmation dialog for `Send Now` and scheduled sends.
- Include recipient count and sample recipients in the confirmation.
- Consider requiring explicit typed confirmation for bulk sends.

### 7. High: draft creation is marked as sent

Saving drafts updates the batch to `status: "sent"` and writes draft-shaped results into a result type intended for sent messages.

Relevant code:
- `src/hooks/useEmailSend.ts`
- `src/lib/batches.ts`

Impact:
- The UI can show drafts as sent.
- Follow-up logic may treat a draft-only parent as a sent parent.
- Result objects may not have `threadId` or `mimeMessageId`, breaking reply behavior.

Recommended fix:
- Add separate statuses such as `drafted`, `sent`, `scheduled`, `partial_failed`.
- Add a distinct draft result type.
- Only enable follow-up reply behavior when the parent has real sent-message metadata.

### 8. High: follow-up delay UI is not implemented in send logic

`scheduledDelay` is stored on follow-up batches, but no send path uses it. Follow-ups are sent immediately when submitted.

Relevant code:
- `src/lib/batches.ts`
- `src/hooks/useBatches.ts`
- `src/hooks/useEmailSend.ts`

Impact:
- The UI says "Send in 3 days", but submitting can send immediately.
- Users may unintentionally send follow-ups too early.

Recommended fix:
- Wire follow-up delay into scheduling.
- Compute follow-up scheduled time from parent send time plus delay.
- Disable immediate follow-up send unless the user explicitly chooses it.
- Make the UI text match the actual behavior.

### 9. Medium: scheduled jobs panel appears unused

`ScheduledJobsPanel` exists, but no current import/render usage was found.

Relevant code:
- `src/components/ScheduledJobsPanel.tsx`

Impact:
- Users may schedule sends but have no visible management surface.
- Cancellation and refresh UI may be unreachable.

Recommended fix:
- Render the scheduled jobs panel in the main app shell or campaign view.
- Scope it to the current user and, if possible, the current campaign.
- Add confirmation before cancel-all behavior.

### 10. Medium: CSV parsing is fragile for real recipient data

The CSV parser splits text by newline and does not support quoted multiline fields. It also trims whole lines before parsing.

Relevant code:
- `src/components/ContactTable.tsx`

Impact:
- Some valid CSV files parse incorrectly.
- Recipient data may be shifted between columns.
- Incorrect imports can lead to emails going to wrong recipients or with wrong personalization.

Recommended fix:
- Use a proven CSV parser.
- Show an import preview before replacing the current contact list.
- Validate all imported rows before allowing send.

## Requirements To Fix These Issues

### Product and behavior decisions

- Decide whether the app is single-user local-only or multi-user production-capable.
- Decide whether immediate send should exist, or whether the default workflow should be draft-first.
- Define confirmation requirements for irreversible sends, including bulk sends.
- Define retry behavior for scheduled sends: retry count, backoff, and terminal failure state.
- Define what should happen when some recipients succeed and others fail.

### Data model requirements

- A durable job store is needed for scheduled sends. A flat JSON file is not sufficient for reliable production behavior.
- Jobs need owner identity, campaign/batch identity, scheduled time, status, and timestamps.
- Recipients need per-recipient status and Gmail response metadata.
- Sent messages and drafts need separate result shapes.
- Scheduled jobs should not store plaintext refresh tokens.

### Security requirements

- Server-side payload validation for every send/draft/schedule route.
- Header-safe encoding and CR/LF rejection for all MIME header values.
- Email address normalization and validation.
- Ownership checks for scheduled job list, delete, and execution.
- Secret storage or encryption strategy if refresh tokens must be persisted.
- Clear policy for OAuth scopes. Keep only scopes required by actual functionality.

### Infrastructure requirements

- For production reliability, use a durable database plus a worker or queue. Examples: Postgres plus a cron/worker, BullMQ plus Redis, or a managed queue.
- For local-only reliability, at minimum add file locking, per-recipient persisted state, and encrypted token storage.
- Avoid relying on Next.js route module imports to run background jobs.
- Add a deployment-compatible scheduler trigger if deploying outside a long-running Node process.

### Testing requirements

- Unit tests for MIME construction, template replacement, HTML escaping, and header sanitization.
- API tests for invalid payloads, invalid emails, CR/LF injection attempts, unauthorized access, and cross-user job access.
- Scheduler tests for partial failures, retries, duplicate prevention, cancellation, and restart recovery.
- UI tests for send confirmation, draft-vs-send status, scheduled job visibility, and CSV import validation.
- A safe Gmail test strategy using mocks or a dedicated test account, not a real recipient list.

### Implementation order

1. Add backend validation and MIME/header safety.
2. Separate draft and sent statuses/results.
3. Add confirmation and preview before irreversible sends.
4. Add job ownership and hide cross-user jobs.
5. Replace or harden scheduled job persistence.
6. Add per-recipient state, retry behavior, and idempotency.
7. Wire follow-up delays into scheduling.
8. Render and harden scheduled job management UI.
9. Replace CSV parsing and add import preview.
10. Add focused tests around all send-critical behavior.

## Verification From Audit

- `npm run lint` passed with 3 warnings.
- `npm run build` passed when run outside the sandbox. The initial sandboxed build failed because Turbopack was blocked from creating/binding a local process.

