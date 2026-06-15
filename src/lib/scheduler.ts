import { OAuth2Client } from "google-auth-library";
import { createAdminClient } from "./supabase/server";
import { decryptToken } from "./encrypt";
import { sendMessage, sendReply, hasRecipientReplied } from "./gmail";
import type { Contact } from "./gmail";
import type { EmailAttachment } from "./attachments";
import { resolveAttachmentForSend } from "./attachment-storage";

export interface ScheduleJobParams {
  userId: string;
  googleAccountId: string;
  batchId: string;
  subject: string;
  body: string;
  signature: string;
  contacts: Contact[];
  attachment?: EmailAttachment | null;
  scheduledAt: string;
  parentThreads?: Record<string, { threadId: string; mimeMessageId: string }>;
}

export interface JobSummary {
  id: string;
  scheduledAt: string;
  subject: string;
  status: string;
  recipientCount: number;
}

interface RecipientSnapshotRow {
  email: string;
  status: string;
  last_error: string | null;
  gmail_message_id: string | null;
  gmail_thread_id: string | null;
  gmail_mime_message_id: string | null;
}

interface ParentRecipientResult {
  email: string;
  status?: string;
  threadId?: string;
  mimeMessageId?: string;
}

function batchTime(row: { sent_at: string | null; scheduled_at: string | null }) {
  return row.sent_at ?? row.scheduled_at;
}

async function isManuallyStoppedInCampaign(
  db: ReturnType<typeof createAdminClient>,
  userId: string,
  campaignId: string,
  email: string
): Promise<boolean> {
  const { data, error } = await db
    .from("batches")
    .select("recipient_results")
    .eq("campaign_id", campaignId)
    .eq("user_id", userId);
  if (error) throw error;

  const key = email.toLowerCase().trim();
  return (data ?? []).some((batch) => {
    const results = Array.isArray(batch.recipient_results)
      ? (batch.recipient_results as ParentRecipientResult[])
      : [];
    return results.some(
      (r) => r.status === "manually_stopped" && r.email.toLowerCase().trim() === key
    );
  });
}

/**
 * Schedule a send for an existing editor batch. Snapshots the current
 * subject/body/signature onto the batch row so processDueJobs sees a stable
 * view, then creates send_job + send_recipients linked to that batch_id.
 */
export async function scheduleJob(params: ScheduleJobParams): Promise<string> {
  const db = createAdminClient();
  const { userId, googleAccountId, batchId, subject, body, signature, contacts, attachment, scheduledAt, parentThreads } = params;

  // Verify ownership.
  const { data: existing, error: existingErr } = await db
    .from("batches")
    .select("id, parent_batch_id, status, scheduled_at, scheduled_job_id, sent_at")
    .eq("id", batchId)
    .eq("user_id", userId)
    .maybeSingle();
  if (existingErr) throw existingErr;
  if (!existing) throw new Error("Batch not found");

  const scheduledTime = new Date(scheduledAt).getTime();
  if (Number.isNaN(scheduledTime) || scheduledTime <= Date.now()) {
    throw new Error("Schedule time must be in the future.");
  }

  if (existing.parent_batch_id) {
    const { data: parent, error: parentErr } = await db
      .from("batches")
      .select("id, status, scheduled_at, sent_at")
      .eq("id", existing.parent_batch_id)
      .eq("user_id", userId)
      .single();
    if (parentErr || !parent) throw parentErr ?? new Error("Previous email not found");
    if (parent.status !== "scheduled" && !parent.sent_at) {
      throw new Error("Schedule the previous email before scheduling this follow-up.");
    }
    const parentTime = batchTime(parent);
    if (!parentTime || scheduledTime <= new Date(parentTime).getTime()) {
      throw new Error("Follow-up must be scheduled after the previous email.");
    }
  }

  const { data: child, error: childErr } = await db
    .from("batches")
    .select("id, scheduled_at, sent_at")
    .eq("parent_batch_id", batchId)
    .eq("user_id", userId)
    .maybeSingle();
  if (childErr) throw childErr;
  const childTime = child ? batchTime(child) : null;
  if (childTime && scheduledTime >= new Date(childTime).getTime()) {
    throw new Error("This email must be scheduled before its follow-up.");
  }

  const idempotencyKey = crypto.randomUUID();
  let jobId: string | undefined;

  try {
    // Snapshot the current values onto the batch and flip status to scheduled.
    // processDueJobs reads subject/body/signature from this row.
    const { error: updateErr } = await db
      .from("batches")
      .update({
        subject,
        body_html: body,
        signature_html: signature,
        attachment: attachment ?? null,
        status: "scheduled",
        scheduled_at: scheduledAt,
      })
      .eq("id", batchId)
      .eq("user_id", userId);
    if (updateErr) throw updateErr;

    const { data: job, error: jobError } = await db
      .from("send_jobs")
      .insert({
        user_id: userId,
        batch_id: batchId,
        google_account_id: googleAccountId,
        kind: existing.parent_batch_id ? "follow_up" : "scheduled_send",
        status: "pending",
        scheduled_at: scheduledAt,
        idempotency_key: idempotencyKey,
      })
      .select("id")
      .single();
    if (jobError || !job) throw jobError ?? new Error("Failed to create send_job");
    jobId = job.id;

    const { error: recipientsError } = await db.from("send_recipients").insert(
      contacts.map((c, i) => {
        const parent = parentThreads?.[c.email];
        // Index-based key keeps uniqueness if the contact list has duplicate emails.
        const rowKey = `${idempotencyKey}:${i}`;
        return {
          user_id: userId,
          job_id: jobId!,
          email: c.email,
          first_name: c.firstName,
          company: c.company,
          custom_fields: c.customFields ?? {},
          status: "pending",
          next_attempt_at: scheduledAt,
          idempotency_key: rowKey,
          parent_thread_id: parent?.threadId ?? null,
          parent_mime_message_id: parent?.mimeMessageId ?? null,
        };
      })
    );
    if (recipientsError) throw recipientsError;

    // Link the job back to the batch for the UI poll.
    const { error: linkError } = await db
      .from("batches")
      .update({ scheduled_job_id: jobId })
      .eq("id", batchId)
      .eq("user_id", userId);
    if (linkError) throw linkError;
  } catch (err) {
    if (jobId) {
      // Roll back the job row so we don't leave a job with no recipients.
      await db.from("send_jobs").delete().eq("id", jobId);
    }
    await db
      .from("batches")
      .update({
        status: existing.status,
        scheduled_at: existing.scheduled_at,
        scheduled_job_id: existing.scheduled_job_id,
      })
      .eq("id", batchId)
      .eq("user_id", userId);
    throw err;
  }

  return jobId!;
}

export async function listJobsForUser(userId: string): Promise<JobSummary[]> {
  const db = createAdminClient();
  const { data, error } = await db
    .from("send_jobs")
    .select("id, scheduled_at, status, batches!send_jobs_batch_id_fkey(subject), send_recipients(id)")
    .eq("user_id", userId)
    .in("status", ["pending", "partial_failed"])
    .order("scheduled_at", { ascending: true });
  if (error) throw error;

  return (data ?? []).map((j) => {
    const batch = j.batches as unknown as { subject: string } | null;
    const recipients = j.send_recipients as unknown as { id: string }[] | null;
    return {
      id: j.id,
      scheduledAt: j.scheduled_at,
      subject: batch?.subject ?? "",
      status: j.status,
      recipientCount: recipients?.length ?? 0,
    };
  });
}

export async function cancelJob(id: string, userId: string): Promise<boolean> {
  const db = createAdminClient();
  const { data, error } = await db
    .from("send_jobs")
    .update({ status: "cancelled", cancelled_at: new Date().toISOString() })
    .eq("id", id)
    .eq("user_id", userId)
    .in("status", ["pending", "partial_failed"])
    .select("batch_id");
  if (error) throw error;
  if (!data?.length) return false;

  // Reset editor state on the linked batch so the node unlocks and the user
  // can edit/reschedule. Only touch batches that were specifically pointing
  // at this job — defensive against multiple jobs per batch.
  const batchIds = (data as { batch_id: string }[]).map((r) => r.batch_id);
  await db
    .from("batches")
    .update({ status: "draft", scheduled_at: null, scheduled_job_id: null })
    .in("id", batchIds)
    .eq("user_id", userId)
    .eq("scheduled_job_id", id);
  return true;
}

export async function cancelAllJobsForUser(userId: string): Promise<number> {
  const db = createAdminClient();
  const { data, error } = await db
    .from("send_jobs")
    .update({ status: "cancelled", cancelled_at: new Date().toISOString() })
    .eq("user_id", userId)
    .in("status", ["pending", "partial_failed"])
    .select("id, batch_id");
  if (error) throw error;
  const rows = (data ?? []) as { id: string; batch_id: string }[];
  if (rows.length === 0) return 0;

  await db
    .from("batches")
    .update({ status: "draft", scheduled_at: null, scheduled_job_id: null })
    .in("scheduled_job_id", rows.map((r) => r.id))
    .eq("user_id", userId);
  return rows.length;
}

async function getAccessToken(refreshToken: string): Promise<string> {
  const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET);
  client.setCredentials({ refresh_token: refreshToken });
  const { token } = await client.getAccessToken();
  if (!token) throw new Error("Failed to obtain access token from refresh token");
  return token;
}

function isTransientError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const msg = err.message.toLowerCase();
  return (
    msg.includes("429") ||
    msg.includes("500") ||
    msg.includes("502") ||
    msg.includes("503") ||
    msg.includes("504") ||
    msg.includes("timeout") ||
    msg.includes("network")
  );
}

export async function processDueJobs(): Promise<{ processed: number; errors: string[] }> {
  const db = createAdminClient();
  const now = new Date().toISOString();
  const stale = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  const workerId = crypto.randomUUID();

  const { data: candidates, error: fetchError } = await db
    .from("send_jobs")
    .select("id")
    .in("status", ["pending", "partial_failed"])
    .lte("scheduled_at", now)
    .or(`locked_at.is.null,locked_at.lt.${stale}`)
    .order("scheduled_at", { ascending: true })
    .limit(5);
  if (fetchError) throw fetchError;
  if (!candidates?.length) return { processed: 0, errors: [] };

  // Atomic claim. Postgres serializes concurrent UPDATEs on the same row; the
  // second UPDATE re-evaluates its WHERE and finds status='running' (or a fresh
  // locked_at) so it matches nothing. .select() returns only the rows this
  // worker actually claimed.
  const candidateIds = candidates.map((c: { id: string }) => c.id);
  const { data: claimed, error: claimError } = await db
    .from("send_jobs")
    .update({ status: "running", locked_at: now, locked_by: workerId, started_at: now })
    .in("id", candidateIds)
    .in("status", ["pending", "partial_failed"])
    .or(`locked_at.is.null,locked_at.lt.${stale}`)
    .select("id");
  if (claimError) throw claimError;
  if (!claimed?.length) return { processed: 0, errors: [] };

  const claimedSet = new Set(claimed.map((c: { id: string }) => c.id));
  const claimedIds = candidateIds.filter((id) => claimedSet.has(id));

  // Restart recovery: a previous worker may have crashed between flipping a
  // recipient to 'sending' and recording the Gmail response. Reset only the
  // rows that have NO gmail_message_id — those provably never had a Gmail id
  // written back to us. Rows with a message id are left in 'sending' and
  // promoted to 'sent' just below; resending them would duplicate a message
  // we know the recipient already received.
  //
  // Residual at-least-once gap: gmail.users.messages.send returns 200, our
  // worker crashes before writing the row, AND the response never makes it
  // back to us. The recipient gets the email but we have no record of it,
  // so recovery retries and they receive a duplicate. True dedup needs an
  // idempotency key Gmail respects; Gmail doesn't offer one, so this is the
  // closest we can get without adding our own Message-ID lookup loop.
  const { error: recoverError } = await db
    .from("send_recipients")
    .update({ status: "pending" })
    .in("job_id", claimedIds)
    .eq("status", "sending")
    .is("gmail_message_id", null);
  if (recoverError) console.error("Failed to recover stuck sending recipients:", recoverError);

  // Sweep up the other half: 'sending' rows that DO have a gmail_message_id
  // are recoverable to 'sent' without re-calling Gmail.
  const { error: promoteError } = await db
    .from("send_recipients")
    .update({ status: "sent", sent_at: new Date().toISOString() })
    .in("job_id", claimedIds)
    .eq("status", "sending")
    .not("gmail_message_id", "is", null);
  if (promoteError) console.error("Failed to promote completed sends:", promoteError);

  const errors: string[] = [];
  let processed = 0;

  for (const jobId of claimedIds) {
    try {
      const { data: job, error: jobLoadError } = await db
        .from("send_jobs")
        .select(
          "id, user_id, batch_id, batches!send_jobs_batch_id_fkey(subject, body_html, signature_html, attachment, parent_batch_id, campaign_id), google_accounts(refresh_token_ciphertext, refresh_token_iv, refresh_token_tag)"
        )
        .eq("id", jobId)
        .single();
      if (jobLoadError || !job) throw jobLoadError ?? new Error("Failed to load job");

      const ga = job.google_accounts as unknown as {
        refresh_token_ciphertext: string | null;
        refresh_token_iv: string | null;
        refresh_token_tag: string | null;
      } | null;
      if (!ga?.refresh_token_ciphertext || !ga.refresh_token_iv || !ga.refresh_token_tag) {
        throw new Error("Missing encrypted refresh token");
      }

      const refreshToken = decryptToken(ga.refresh_token_ciphertext, ga.refresh_token_iv, ga.refresh_token_tag);
      const accessToken = await getAccessToken(refreshToken);

      const batch = job.batches as unknown as {
        subject: string;
        body_html: string;
        signature_html: string;
        attachment: EmailAttachment | null;
        parent_batch_id: string | null;
        campaign_id: string;
      } | null;
      const subject = batch?.subject ?? "";
      const body = batch?.body_html ?? "";
      const signature = batch?.signature_html || undefined;
      const attachment = batch?.attachment ?? undefined;
      const parentBatchId = batch?.parent_batch_id ?? null;
      let parentResultsByEmail: Map<string, ParentRecipientResult> | null = null;
      let manualStopsByEmail: Map<string, ParentRecipientResult> | null = null;

      if (parentBatchId) {
        const { data: parentBatch, error: parentBatchError } = await db
          .from("batches")
          .select("status, sent_at, recipient_results")
          .eq("id", parentBatchId)
          .eq("user_id", job.user_id)
          .single();
        if (parentBatchError || !parentBatch) {
          throw parentBatchError ?? new Error("Previous email not found");
        }

        if (parentBatch.status === "scheduled" || !parentBatch.sent_at) {
          await db
            .from("send_jobs")
            .update({ status: "pending", locked_at: null, locked_by: null })
            .eq("id", jobId)
            .eq("locked_by", workerId);
          continue;
        }

        const parentResults = Array.isArray(parentBatch.recipient_results)
          ? (parentBatch.recipient_results as ParentRecipientResult[])
          : [];
        parentResultsByEmail = new Map(
          parentResults.map((r) => [r.email.toLowerCase().trim(), r])
        );

        const { data: chainBatches, error: chainBatchesError } = await db
          .from("batches")
          .select("recipient_results")
          .eq("campaign_id", batch?.campaign_id)
          .eq("user_id", job.user_id);
        if (chainBatchesError) throw chainBatchesError;
        const manualStops = (chainBatches ?? []).flatMap((b) =>
          Array.isArray(b.recipient_results)
            ? (b.recipient_results as ParentRecipientResult[]).filter(
                (r) => r.status === "manually_stopped"
              )
            : []
        );
        manualStopsByEmail = new Map(
          manualStops.map((r) => [r.email.toLowerCase().trim(), r])
        );
      }

      const preparedAttachment = await resolveAttachmentForSend(attachment, job.user_id, job.batch_id);

      const { data: recipients, error: recipientsError } = await db
        .from("send_recipients")
        .select(
          "id, email, first_name, company, custom_fields, attempts, parent_thread_id, parent_mime_message_id"
        )
        .eq("job_id", jobId)
        .eq("status", "pending")
        .lte("next_attempt_at", now);
      if (recipientsError) throw recipientsError;

      for (const recipient of recipients ?? []) {
        // Atomic recipient claim: only the worker that flips pending→sending
        // proceeds with the Gmail call. Prevents two workers from sending the
        // same recipient if claim of the parent job ever races.
        const { data: claimedR, error: claimRError } = await db
          .from("send_recipients")
          .update({ status: "sending" })
          .eq("id", recipient.id)
          .eq("status", "pending")
          .select("id");
        if (claimRError) {
          errors.push(`${recipient.email}: claim failed: ${claimRError.message}`);
          continue;
        }
        if (!claimedR?.length) continue;

        const contact: Contact = {
          email: recipient.email,
          firstName: recipient.first_name,
          company: recipient.company,
          customFields: (recipient.custom_fields ?? {}) as Record<string, string>,
        };
        let parentThreadId = recipient.parent_thread_id;
        let parentMimeMessageId = recipient.parent_mime_message_id;
        const parentResult = parentBatchId
          ? parentResultsByEmail?.get(recipient.email.toLowerCase().trim())
          : undefined;
        const manualStop = parentBatchId
          ? manualStopsByEmail?.get(recipient.email.toLowerCase().trim())
          : undefined;

        if (manualStop) {
          const { error: manualStopError } = await db
            .from("send_recipients")
            .update({
              status: "manually_stopped",
              last_error: "Sequence manually stopped.",
              last_error_at: new Date().toISOString(),
              gmail_thread_id: parentThreadId ?? manualStop.threadId ?? null,
              gmail_mime_message_id: parentMimeMessageId ?? manualStop.mimeMessageId ?? null,
            })
            .eq("id", recipient.id);
          if (manualStopError) {
            errors.push(`${contact.email}: manual stop update failed: ${manualStopError.message}`);
          }
          continue;
        }

        if (parentBatchId && (!parentThreadId || !parentMimeMessageId)) {
          if (parentResult?.threadId && parentResult.mimeMessageId) {
            parentThreadId = parentResult.threadId;
            parentMimeMessageId = parentResult.mimeMessageId;
          } else {
            const { error: parentMissingError } = await db
              .from("send_recipients")
              .update({
                status: "failed",
                attempts: recipient.attempts + 1,
                next_attempt_at: null,
                last_error: "Previous email was not sent to this recipient.",
                last_error_at: new Date().toISOString(),
              })
              .eq("id", recipient.id);
            if (parentMissingError) {
              errors.push(`${contact.email}: parent lookup failed: ${parentMissingError.message}`);
            }
            continue;
          }
        }

        // Reply-skip check for follow-ups. We copy parent_thread_id forward
        // into gmail_thread_id so any further follow-ups in the chain can
        // still detect the reply and skip too.
        if (parentThreadId && parentMimeMessageId) {
          const replied = await hasRecipientReplied(
            accessToken,
            parentThreadId,
            recipient.email
          );
          if (replied) {
            const { error: skipError } = await db
              .from("send_recipients")
              .update({
                status: "skipped_replied",
                last_error: "Recipient already replied to the thread.",
                last_error_at: new Date().toISOString(),
                gmail_thread_id: parentThreadId,
                gmail_mime_message_id: parentMimeMessageId,
              })
              .eq("id", recipient.id);
            if (skipError) {
              errors.push(`${contact.email}: skip update failed: ${skipError.message}`);
            }
            continue;
          }
        }

        if (
          batch?.campaign_id &&
          await isManuallyStoppedInCampaign(
            db,
            job.user_id,
            batch.campaign_id,
            recipient.email
          )
        ) {
          const { error: manualStopError } = await db
            .from("send_recipients")
            .update({
              status: "manually_stopped",
              last_error: "Sequence manually stopped.",
              last_error_at: new Date().toISOString(),
              gmail_thread_id: parentThreadId ?? null,
              gmail_mime_message_id: parentMimeMessageId ?? null,
            })
            .eq("id", recipient.id);
          if (manualStopError) {
            errors.push(`${contact.email}: manual stop update failed: ${manualStopError.message}`);
          }
          continue;
        }

        try {
          const result =
            parentThreadId && parentMimeMessageId
              ? await sendReply(
                  accessToken,
                  contact,
                  parentThreadId,
                  parentMimeMessageId,
                  subject,
                  body,
                  signature,
                  undefined,
                  undefined,
                  preparedAttachment
                )
              : await sendMessage(accessToken, contact, subject, body, signature, undefined, undefined, preparedAttachment);

          const { error: markSentError } = await db
            .from("send_recipients")
            .update({
              status: "sent",
              sent_at: new Date().toISOString(),
              gmail_message_id: result.id ?? "",
              gmail_thread_id: result.threadId ?? "",
              gmail_mime_message_id: result.mimeMessageId,
              last_error: null,
              last_error_at: null,
            })
            .eq("id", recipient.id);
          if (markSentError) {
            errors.push(`${contact.email}: mark sent failed: ${markSentError.message}`);
          }
        } catch (err: unknown) {
          const errMsg = err instanceof Error ? err.message : "Unknown error";
          const attempts = recipient.attempts + 1;
          const retryDelays = [5 * 60, 30 * 60, 2 * 60 * 60];
          const transient = isTransientError(err) && attempts < 3;

          const update = transient
            ? {
                status: "pending" as const,
                attempts,
                next_attempt_at: new Date(
                  Date.now() + (retryDelays[attempts - 1] ?? 2 * 60 * 60) * 1000
                ).toISOString(),
                last_error: errMsg,
                last_error_at: new Date().toISOString(),
              }
            : {
                status: "failed" as const,
                attempts,
                next_attempt_at: null,
                last_error: errMsg,
                last_error_at: new Date().toISOString(),
              };

          const { error: updateError } = await db
            .from("send_recipients")
            .update(update)
            .eq("id", recipient.id);
          if (updateError) {
            errors.push(`${contact.email}: status update failed: ${updateError.message}`);
          }
          errors.push(`${contact.email}: ${errMsg}`);
        }
      }

      const { data: stats, error: statsError } = await db
        .from("send_recipients")
        .select("email, status, last_error, gmail_message_id, gmail_thread_id, gmail_mime_message_id")
        .eq("job_id", jobId);
      if (statsError) throw statsError;

      const recipientRows = (stats ?? []) as RecipientSnapshotRow[];
      const failedCount =
        recipientRows.filter((r) => r.status === "failed").length;
      const pendingCount =
        recipientRows.filter((r) => r.status === "pending" || r.status === "sending").length;
      const finalStatus =
        pendingCount > 0
          ? "partial_failed"
          : failedCount === 0
          ? "completed"
          : "failed";
      const completedAt = pendingCount === 0 ? new Date().toISOString() : null;

      const { error: finalizeError } = await db
        .from("send_jobs")
        .update({
          status: finalStatus,
          completed_at: completedAt,
          locked_at: null,
          locked_by: null,
        })
        .eq("id", jobId);
      if (finalizeError) {
        errors.push(`job ${jobId}: finalize failed: ${finalizeError.message}`);
      }

      if (completedAt) {
        const recipientResults = recipientRows
          .filter((r) =>
            r.status === "sent" ||
            r.status === "failed" ||
            r.status === "skipped_replied" ||
            r.status === "manually_stopped"
          )
          .map((r) => ({
            email: r.email,
            status: r.status,
            messageId: r.gmail_message_id ?? undefined,
            threadId: r.gmail_thread_id ?? undefined,
            mimeMessageId: r.gmail_mime_message_id ?? undefined,
            error: r.last_error ?? undefined,
          }));
        const { error: batchFinalizeError } = await db
          .from("batches")
          .update({
            status: finalStatus === "completed" ? "sent" : finalStatus,
            sent_at: completedAt,
            recipient_results: recipientResults,
          })
          .eq("id", job.batch_id)
          .eq("user_id", job.user_id);
        if (batchFinalizeError) {
          errors.push(`job ${jobId}: batch finalize failed: ${batchFinalizeError.message}`);
        }
      }

      processed++;
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : "Unknown error";
      errors.push(`job ${jobId}: ${errMsg}`);
      // Release the claim. locked_by guard ensures we only unlock our own claim.
      await db
        .from("send_jobs")
        .update({ status: "pending", locked_at: null, locked_by: null })
        .eq("id", jobId)
        .eq("locked_by", workerId);
    }
  }

  return { processed, errors };
}
