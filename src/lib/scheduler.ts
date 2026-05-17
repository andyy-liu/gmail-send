import { OAuth2Client } from "google-auth-library";
import { createAdminClient } from "./supabase/server";
import { decryptToken } from "./encrypt";
import { sendMessage, sendReply } from "./gmail";
import type { Contact } from "./gmail";

export interface ScheduleJobParams {
  userId: string;
  googleAccountId: string;
  subject: string;
  body: string;
  signature: string;
  contacts: Contact[];
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

export async function scheduleJob(params: ScheduleJobParams): Promise<string> {
  const db = createAdminClient();
  const { userId, googleAccountId, subject, body, signature, contacts, scheduledAt, parentThreads } = params;

  // Insert chain is not transactional in the Supabase JS client. On any later
  // failure, cascade-delete the campaign so we don't leak orphan rows.
  let campaignId: string | undefined;
  try {
    const { data: campaign, error: campaignError } = await db
      .from("campaigns")
      .insert({ user_id: userId, name: subject })
      .select("id")
      .single();
    if (campaignError || !campaign) throw campaignError ?? new Error("Failed to create campaign");
    campaignId = campaign.id;

    const { data: batch, error: batchError } = await db
      .from("batches")
      .insert({
        user_id: userId,
        campaign_id: campaign.id,
        name: subject,
        subject,
        body_html: body,
        signature_html: signature,
        status: "scheduled",
        scheduled_at: scheduledAt,
      })
      .select("id")
      .single();
    if (batchError || !batch) throw batchError ?? new Error("Failed to create batch");

    const { data: insertedContacts, error: contactsError } = await db
      .from("contacts")
      .insert(
        contacts.map((c, i) => ({
          user_id: userId,
          batch_id: batch.id,
          email: c.email,
          first_name: c.firstName,
          company: c.company,
          position: i,
        }))
      )
      .select();
    if (contactsError || !insertedContacts) throw contactsError ?? new Error("Failed to create contacts");

    const idempotencyKey = crypto.randomUUID();
    const { data: job, error: jobError } = await db
      .from("send_jobs")
      .insert({
        user_id: userId,
        batch_id: batch.id,
        google_account_id: googleAccountId,
        kind: parentThreads ? "follow_up" : "scheduled_send",
        status: "pending",
        scheduled_at: scheduledAt,
        idempotency_key: idempotencyKey,
      })
      .select("id")
      .single();
    if (jobError || !job) throw jobError ?? new Error("Failed to create send_job");

    const { error: recipientsError } = await db.from("send_recipients").insert(
      insertedContacts.map(
        (c: { id: string; email: string; first_name: string; company: string }) => {
          const parent = parentThreads?.[c.email];
          return {
            user_id: userId,
            job_id: job.id,
            contact_id: c.id,
            email: c.email,
            first_name: c.first_name,
            company: c.company,
            status: "pending",
            next_attempt_at: scheduledAt,
            idempotency_key: `${idempotencyKey}:${c.id}`,
            parent_thread_id: parent?.threadId ?? null,
            parent_mime_message_id: parent?.mimeMessageId ?? null,
          };
        }
      )
    );
    if (recipientsError) throw recipientsError;

    return job.id;
  } catch (err) {
    if (campaignId) {
      // Cascade-delete on campaigns FK removes batch, contacts, send_jobs, send_recipients.
      await db.from("campaigns").delete().eq("id", campaignId);
    }
    throw err;
  }
}

export async function listJobsForUser(userId: string): Promise<JobSummary[]> {
  const db = createAdminClient();
  const { data, error } = await db
    .from("send_jobs")
    .select("id, scheduled_at, status, batches(subject), send_recipients(id)")
    .eq("user_id", userId)
    .neq("status", "cancelled")
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
    .eq("status", "pending")
    .select();
  if (error) throw error;
  return (data?.length ?? 0) > 0;
}

export async function cancelAllJobsForUser(userId: string): Promise<number> {
  const db = createAdminClient();
  const { data, error } = await db
    .from("send_jobs")
    .update({ status: "cancelled", cancelled_at: new Date().toISOString() })
    .eq("user_id", userId)
    .eq("status", "pending")
    .select();
  if (error) throw error;
  return data?.length ?? 0;
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

  const claimedIds = claimed.map((c: { id: string }) => c.id);

  // Restart recovery: a previous worker may have crashed between flipping a
  // recipient to 'sending' and recording the Gmail response. Now that we own
  // the job, reset any 'sending' rows so we can retry them. We accept the
  // small chance of a duplicate send if the prior worker did reach Gmail.
  const { error: recoverError } = await db
    .from("send_recipients")
    .update({ status: "pending" })
    .in("job_id", claimedIds)
    .eq("status", "sending");
  if (recoverError) console.error("Failed to recover stuck sending recipients:", recoverError);

  const errors: string[] = [];
  let processed = 0;

  for (const jobId of claimedIds) {
    try {
      const { data: job, error: jobLoadError } = await db
        .from("send_jobs")
        .select(
          "id, user_id, batches(subject, body_html, signature_html), google_accounts(refresh_token_ciphertext, refresh_token_iv, refresh_token_tag)"
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
      } | null;
      const subject = batch?.subject ?? "";
      const body = batch?.body_html ?? "";
      const signature = batch?.signature_html || undefined;

      const { data: recipients, error: recipientsError } = await db
        .from("send_recipients")
        .select(
          "id, email, first_name, company, attempts, parent_thread_id, parent_mime_message_id"
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
        };

        try {
          const result =
            recipient.parent_thread_id && recipient.parent_mime_message_id
              ? await sendReply(
                  accessToken,
                  contact,
                  recipient.parent_thread_id,
                  recipient.parent_mime_message_id,
                  subject,
                  body,
                  signature
                )
              : await sendMessage(accessToken, contact, subject, body, signature);

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
        .select("status")
        .eq("job_id", jobId);
      if (statsError) throw statsError;

      const failedCount =
        stats?.filter((r: { status: string }) => r.status === "failed").length ?? 0;
      const pendingCount =
        stats?.filter(
          (r: { status: string }) => r.status === "pending" || r.status === "sending"
        ).length ?? 0;
      const finalStatus =
        failedCount === 0 && pendingCount === 0
          ? "completed"
          : pendingCount > 0
          ? "partial_failed"
          : "failed";

      const { error: finalizeError } = await db
        .from("send_jobs")
        .update({
          status: finalStatus,
          completed_at: pendingCount === 0 ? new Date().toISOString() : null,
          locked_at: null,
          locked_by: null,
        })
        .eq("id", jobId);
      if (finalizeError) {
        errors.push(`job ${jobId}: finalize failed: ${finalizeError.message}`);
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
