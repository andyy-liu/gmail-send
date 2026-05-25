import { createAdminClient } from "@/lib/supabase/server";
import type { Batch, ContactRow, RecipientResult } from "@/lib/batches";
import type { CustomVariable } from "@/lib/variables";
import { listVariables } from "@/lib/sync/variables-repo";

// DB enum maps. The schema uses 'draft' where the UI uses 'active'.
type DbBatchStatus = "draft" | "drafted" | "scheduled" | "sending" | "sent" | "partial_failed" | "failed" | "cancelled";
type UiBatchStatus = Batch["status"];

function toUiStatus(s: DbBatchStatus): UiBatchStatus {
  if (s === "draft") return "active";
  if (s === "drafted") return "drafted";
  if (s === "scheduled") return "scheduled";
  if (s === "sent") return "sent";
  // sending/partial_failed/failed/cancelled all surface as 'sent' (terminal) in the editor
  // so the node locks and the recipient_results are visible.
  return "sent";
}

function toDbStatus(s: UiBatchStatus): DbBatchStatus {
  if (s === "active") return "draft";
  return s;
}

interface DbBatch {
  id: string;
  campaign_id: string;
  parent_batch_id: string | null;
  name: string;
  subject: string;
  body_html: string;
  signature_html?: string;
  status: DbBatchStatus;
  scheduled_at: string | null;
  scheduled_delay_value: number | string | null;
  scheduled_delay_unit: string | null;
  recipient_results: RecipientResult[] | null;
  scheduled_job_id: string | null;
  sent_at: string | null;
  created_at: string;
}

interface DbContact {
  id: string;
  batch_id: string;
  email: string;
  first_name: string;
  company: string;
  custom_fields: Record<string, string> | null;
  position: number;
}

function rowToBatch(b: DbBatch, contacts: ContactRow[]): Batch {
  const batch: Batch = {
    id: b.id,
    name: b.name,
    subject: b.subject,
    body: b.body_html,
    contacts,
    status: toUiStatus(b.status),
    createdAt: b.created_at,
  };
  if (b.parent_batch_id) batch.parentBatchId = b.parent_batch_id;
  if (b.sent_at) batch.sentAt = b.sent_at;
  if (b.scheduled_at) batch.scheduledAt = b.scheduled_at;
  if (b.scheduled_delay_value != null && b.scheduled_delay_unit) {
    batch.scheduledDelay = {
      value: Number(b.scheduled_delay_value),
      unit: b.scheduled_delay_unit as "days" | "hours",
    };
  }
  if (b.scheduled_job_id) batch.scheduledJobId = b.scheduled_job_id;
  if (b.recipient_results) batch.recipientResults = b.recipient_results;
  return batch;
}

function dbContactToRow(c: DbContact): ContactRow {
  return {
    id: c.id,
    email: c.email,
    firstName: c.first_name,
    company: c.company,
    customFields: c.custom_fields ?? {},
  };
}

/** Load the full editor state for a user: signature + variables + every batch with contacts. */
export async function loadUserState(userId: string): Promise<{
  signature: string;
  batches: Batch[];
  variables: CustomVariable[];
}> {
  const db = createAdminClient();

  const { data: user, error: userErr } = await db
    .from("app_users")
    .select("signature_html")
    .eq("id", userId)
    .single();
  if (userErr) throw userErr;

  const { data: batchRows, error: batchErr } = await db
    .from("batches")
    .select(
      "id, campaign_id, parent_batch_id, name, subject, body_html, status, scheduled_at, scheduled_delay_value, scheduled_delay_unit, recipient_results, scheduled_job_id, sent_at, created_at"
    )
    .eq("user_id", userId)
    .order("created_at", { ascending: true });
  if (batchErr) throw batchErr;

  const batchIds = (batchRows ?? []).map((b) => b.id);
  let contactsByBatch = new Map<string, ContactRow[]>();
  if (batchIds.length) {
    const { data: contactRows, error: contactsErr } = await db
      .from("contacts")
      .select("id, batch_id, email, first_name, company, custom_fields, position")
      .in("batch_id", batchIds)
      .order("position", { ascending: true });
    if (contactsErr) throw contactsErr;
    contactsByBatch = (contactRows ?? []).reduce((acc, c: DbContact) => {
      const list = acc.get(c.batch_id) ?? [];
      list.push(dbContactToRow(c));
      acc.set(c.batch_id, list);
      return acc;
    }, new Map<string, ContactRow[]>());
  }

  const batches = (batchRows ?? []).map((b: DbBatch) =>
    rowToBatch(b, contactsByBatch.get(b.id) ?? [])
  );

  const variables = await listVariables(userId);

  return { signature: user?.signature_html ?? "", batches, variables };
}

/** Create a new campaign with an empty root batch. Returns the root batch. */
export async function createCampaign(userId: string, name: string): Promise<Batch> {
  const db = createAdminClient();

  const { data: campaign, error: campaignErr } = await db
    .from("campaigns")
    .insert({ user_id: userId, name })
    .select("id")
    .single();
  if (campaignErr || !campaign) throw campaignErr ?? new Error("Failed to create campaign");

  const { data: batch, error: batchErr } = await db
    .from("batches")
    .insert({
      user_id: userId,
      campaign_id: campaign.id,
      name,
      subject: "",
      body_html: "",
      status: "draft",
    })
    .select(
      "id, campaign_id, parent_batch_id, name, subject, body_html, status, scheduled_at, scheduled_delay_value, scheduled_delay_unit, recipient_results, scheduled_job_id, sent_at, created_at"
    )
    .single();
  if (batchErr || !batch) {
    // Clean up the campaign row so we don't leak it.
    await db.from("campaigns").delete().eq("id", campaign.id);
    throw batchErr ?? new Error("Failed to create root batch");
  }

  // Start with one empty contact row so the contacts table renders a placeholder.
  const { data: contactRows, error: contactErr } = await db
    .from("contacts")
    .insert({
      user_id: userId,
      batch_id: batch.id,
      email: "",
      first_name: "",
      company: "",
      position: 0,
    })
    .select("id, batch_id, email, first_name, company, custom_fields, position");
  if (contactErr) throw contactErr;

  return rowToBatch(batch as DbBatch, (contactRows ?? []).map(dbContactToRow));
}

/** Create a follow-up batch under an existing parent. */
export async function createFollowUp(userId: string, parentId: string): Promise<Batch> {
  const db = createAdminClient();

  const { data: parent, error: parentErr } = await db
    .from("batches")
    .select("id, campaign_id, subject")
    .eq("id", parentId)
    .eq("user_id", userId)
    .single();
  if (parentErr || !parent) throw new Error("Parent batch not found");

  const { data: batch, error: batchErr } = await db
    .from("batches")
    .insert({
      user_id: userId,
      campaign_id: parent.campaign_id,
      parent_batch_id: parent.id,
      name: "Follow Up",
      subject: parent.subject,
      body_html: "",
      status: "draft",
    })
    .select(
      "id, campaign_id, parent_batch_id, name, subject, body_html, status, scheduled_at, scheduled_delay_value, scheduled_delay_unit, recipient_results, scheduled_job_id, sent_at, created_at"
    )
    .single();
  if (batchErr || !batch) throw batchErr ?? new Error("Failed to create follow-up");

  return rowToBatch(batch as DbBatch, []);
}

function copyName(baseName: string, existingNames: Set<string>): string {
  const suffix = " Copy";
  const maxLen = 200;
  const trimmedBase = baseName.trim() || "Campaign";
  const base = trimmedBase.length + suffix.length > maxLen
    ? trimmedBase.slice(0, maxLen - suffix.length).trim()
    : trimmedBase;

  let candidate = `${base}${suffix}`;
  let num = 2;
  while (existingNames.has(candidate)) {
    const nextSuffix = ` Copy ${num}`;
    const nextBase = trimmedBase.length + nextSuffix.length > maxLen
      ? trimmedBase.slice(0, maxLen - nextSuffix.length).trim()
      : trimmedBase;
    candidate = `${nextBase}${nextSuffix}`;
    num++;
  }
  return candidate;
}

function draftScheduledAtForCopy(batch: DbBatch): string | null {
  if (!batch.scheduled_at) return null;
  const scheduledTime = new Date(batch.scheduled_at).getTime();
  if (Number.isNaN(scheduledTime) || scheduledTime <= Date.now()) return null;
  return batch.scheduled_at;
}

/** Duplicate a root campaign and its email chain into fresh draft batches. */
export async function duplicateCampaign(userId: string, rootBatchId: string): Promise<Batch[]> {
  const db = createAdminClient();

  const { data: root, error: rootErr } = await db
    .from("batches")
    .select("id, campaign_id, parent_batch_id, name")
    .eq("id", rootBatchId)
    .eq("user_id", userId)
    .single();
  if (rootErr || !root) throw new Error("Campaign not found");
  if (root.parent_batch_id !== null) throw new Error("Batch is not a campaign");

  const { data: campaignRows, error: namesErr } = await db
    .from("campaigns")
    .select("name")
    .eq("user_id", userId);
  if (namesErr) throw namesErr;

  const newName = copyName(root.name, new Set((campaignRows ?? []).map((c) => c.name)));

  const { data: batchRows, error: batchErr } = await db
    .from("batches")
    .select(
      "id, campaign_id, parent_batch_id, name, subject, body_html, signature_html, status, scheduled_at, scheduled_delay_value, scheduled_delay_unit, recipient_results, scheduled_job_id, sent_at, created_at"
    )
    .eq("user_id", userId)
    .eq("campaign_id", root.campaign_id)
    .order("created_at", { ascending: true });
  if (batchErr) throw batchErr;

  const sourceBatches = (batchRows ?? []) as DbBatch[];
  if (!sourceBatches.length) throw new Error("Campaign not found");

  const sourceIds = sourceBatches.map((b) => b.id);
  const { data: contactRows, error: contactsErr } = await db
    .from("contacts")
    .select("id, batch_id, email, first_name, company, custom_fields, position")
    .in("batch_id", sourceIds)
    .order("position", { ascending: true });
  if (contactsErr) throw contactsErr;

  const contactsByBatch = (contactRows ?? []).reduce((acc, c: DbContact) => {
    const list = acc.get(c.batch_id) ?? [];
    list.push(c);
    acc.set(c.batch_id, list);
    return acc;
  }, new Map<string, DbContact[]>());

  const { data: campaign, error: campaignErr } = await db
    .from("campaigns")
    .insert({ user_id: userId, name: newName })
    .select("id")
    .single();
  if (campaignErr || !campaign) throw campaignErr ?? new Error("Failed to create campaign copy");

  const copiedRows: DbBatch[] = [];
  const copiedContactsByBatch = new Map<string, ContactRow[]>();
  const idMap = new Map<string, string>();
  try {
    for (const source of sourceBatches) {
      const parentBatchId = source.parent_batch_id ? idMap.get(source.parent_batch_id) : null;
      if (source.parent_batch_id && !parentBatchId) {
        throw new Error("Cannot duplicate campaign with missing parent batch");
      }

      const isRoot = source.id === rootBatchId;
      const { data: copied, error: copyErr } = await db
        .from("batches")
        .insert({
          user_id: userId,
          campaign_id: campaign.id,
          parent_batch_id: parentBatchId,
          name: isRoot ? newName : source.name,
          subject: source.subject,
          body_html: source.body_html,
          signature_html: source.signature_html ?? "",
          status: "draft",
          scheduled_at: draftScheduledAtForCopy(source),
          scheduled_delay_value: source.scheduled_delay_value,
          scheduled_delay_unit: source.scheduled_delay_unit,
        })
        .select(
          "id, campaign_id, parent_batch_id, name, subject, body_html, status, scheduled_at, scheduled_delay_value, scheduled_delay_unit, recipient_results, scheduled_job_id, sent_at, created_at"
        )
        .single();
      if (copyErr || !copied) throw copyErr ?? new Error("Failed to create batch copy");

      idMap.set(source.id, copied.id);
      copiedRows.push(copied as DbBatch);

      const contacts = contactsByBatch.get(source.id) ?? [];
      if (contacts.length) {
        const { data: copiedContacts, error: insertContactsErr } = await db
          .from("contacts")
          .insert(
            contacts.map((c, i) => ({
              user_id: userId,
              batch_id: copied.id,
              email: c.email,
              first_name: c.first_name,
              company: c.company,
              custom_fields: c.custom_fields ?? {},
              position: i,
            }))
          )
          .select("id, batch_id, email, first_name, company, custom_fields, position");
        if (insertContactsErr) throw insertContactsErr;
        copiedContactsByBatch.set(copied.id, (copiedContacts ?? []).map(dbContactToRow));
      } else {
        copiedContactsByBatch.set(copied.id, []);
      }
    }
  } catch (err) {
    await db.from("campaigns").delete().eq("id", campaign.id).eq("user_id", userId);
    throw err;
  }

  return copiedRows.map((b) => rowToBatch(b, copiedContactsByBatch.get(b.id) ?? []));
}

export interface BatchPatch {
  name?: string;
  subject?: string;
  body?: string;
  status?: UiBatchStatus;
  scheduledAt?: string | null;
  scheduledDelay?: { value: number; unit: "days" | "hours" } | null;
  scheduledJobId?: string | null;
  sentAt?: string | null;
  recipientResults?: RecipientResult[] | null;
}

/** Patch a batch. For root batches, mirrors name into the matching campaigns row. */
export async function updateBatch(userId: string, batchId: string, patch: BatchPatch): Promise<void> {
  const db = createAdminClient();

  const update: Record<string, unknown> = {};
  if (patch.name !== undefined) update.name = patch.name;
  if (patch.subject !== undefined) update.subject = patch.subject;
  if (patch.body !== undefined) update.body_html = patch.body;
  if (patch.status !== undefined) update.status = toDbStatus(patch.status);
  if (patch.scheduledAt !== undefined) update.scheduled_at = patch.scheduledAt;
  if (patch.scheduledJobId !== undefined) update.scheduled_job_id = patch.scheduledJobId;
  if (patch.sentAt !== undefined) update.sent_at = patch.sentAt;
  if (patch.recipientResults !== undefined) update.recipient_results = patch.recipientResults;
  if (patch.scheduledDelay !== undefined) {
    if (patch.scheduledDelay === null) {
      update.scheduled_delay_value = null;
      update.scheduled_delay_unit = null;
    } else {
      update.scheduled_delay_value = patch.scheduledDelay.value;
      update.scheduled_delay_unit = patch.scheduledDelay.unit;
    }
  }

  if (Object.keys(update).length === 0) return;

  const { data: updated, error } = await db
    .from("batches")
    .update(update)
    .eq("id", batchId)
    .eq("user_id", userId)
    .select("campaign_id, parent_batch_id")
    .single();
  if (error || !updated) throw error ?? new Error("Batch not found");

  // Keep campaigns.name in sync with the root batch's name so listJobsForUser
  // and other server reads stay coherent if they ever read campaigns.name.
  if (patch.name !== undefined && updated.parent_batch_id === null) {
    await db
      .from("campaigns")
      .update({ name: patch.name })
      .eq("id", updated.campaign_id)
      .eq("user_id", userId);
  }
}

/**
 * Delete a batch. For a root batch (campaign), deletes the whole campaign so
 * that batches/contacts/jobs/recipients cascade away. For a non-root batch,
 * deletes just the batch — children cascade via batches.parent_batch_id FK
 * (on delete set null) so we walk the subtree manually to remove descendants.
 */
export async function deleteBatch(userId: string, batchId: string): Promise<void> {
  const db = createAdminClient();

  const { data: target, error: loadErr } = await db
    .from("batches")
    .select("id, campaign_id, parent_batch_id")
    .eq("id", batchId)
    .eq("user_id", userId)
    .single();
  if (loadErr || !target) throw new Error("Batch not found");

  if (target.parent_batch_id === null) {
    // Root: delete the campaign. Cascade removes everything.
    const { error } = await db
      .from("campaigns")
      .delete()
      .eq("id", target.campaign_id)
      .eq("user_id", userId);
    if (error) throw error;
    return;
  }

  // Non-root: collect descendants in-memory and delete bottom-up.
  const { data: allBatches, error: listErr } = await db
    .from("batches")
    .select("id, parent_batch_id")
    .eq("user_id", userId)
    .eq("campaign_id", target.campaign_id);
  if (listErr) throw listErr;

  const toDelete = new Set<string>();
  const queue = [batchId];
  while (queue.length) {
    const id = queue.pop()!;
    toDelete.add(id);
    (allBatches ?? [])
      .filter((b) => b.parent_batch_id === id)
      .forEach((b) => queue.push(b.id));
  }

  const { error: delErr } = await db
    .from("batches")
    .delete()
    .in("id", Array.from(toDelete))
    .eq("user_id", userId);
  if (delErr) throw delErr;
}

/** Replace the contacts list for a batch. */
export async function replaceContacts(userId: string, batchId: string, contacts: ContactRow[]): Promise<void> {
  const db = createAdminClient();

  const { data: owned, error: ownErr } = await db
    .from("batches")
    .select("id")
    .eq("id", batchId)
    .eq("user_id", userId)
    .maybeSingle();
  if (ownErr) throw ownErr;
  if (!owned) throw new Error("Batch not found");

  // Wipe + reinsert. With send_recipients keyed off send_jobs (not contacts),
  // dropping contacts is safe — only the contact_id reference in send_recipients
  // is FK 'on delete set null' so historical jobs stay intact.
  const { error: delErr } = await db
    .from("contacts")
    .delete()
    .eq("batch_id", batchId);
  if (delErr) throw delErr;

  if (contacts.length === 0) return;

  const rows = contacts.map((c, i) => ({
    user_id: userId,
    batch_id: batchId,
    email: c.email,
    first_name: c.firstName,
    company: c.company,
    custom_fields: c.customFields ?? {},
    position: i,
  }));
  const { error: insErr } = await db.from("contacts").insert(rows);
  if (insErr) throw insErr;
}

/**
 * Persist the final outcome of a send/now run. Called from the server route
 * after the Gmail loop completes so the client can't fabricate sent state.
 * sentAt is server-clock to avoid trusting any client-provided timestamp.
 */
export async function recordSendOutcome(
  userId: string,
  batchId: string,
  recipientResults: RecipientResult[]
): Promise<void> {
  const db = createAdminClient();
  const { error } = await db
    .from("batches")
    .update({
      status: "sent",
      sent_at: new Date().toISOString(),
      recipient_results: recipientResults,
    })
    .eq("id", batchId)
    .eq("user_id", userId);
  if (error) throw error;
}

/**
 * Mark the given recipients as `replied` on this batch. Reads the current
 * recipient_results, flips matching emails from `sent` → `replied`, and writes
 * it back. Returns the updated results. Other rows (failed / already-replied /
 * skipped_replied) are left as-is.
 */
export async function markRecipientsReplied(
  userId: string,
  batchId: string,
  repliedEmails: string[]
): Promise<RecipientResult[]> {
  const db = createAdminClient();
  const { data: row, error: loadErr } = await db
    .from("batches")
    .select("recipient_results")
    .eq("id", batchId)
    .eq("user_id", userId)
    .single();
  if (loadErr) throw loadErr;

  const current = Array.isArray(row?.recipient_results)
    ? (row.recipient_results as RecipientResult[])
    : [];
  const repliedSet = new Set(repliedEmails.map((e) => e.toLowerCase().trim()));
  const updated = current.map((r) =>
    r.status === "sent" && repliedSet.has(r.email.toLowerCase().trim())
      ? { ...r, status: "replied" as const }
      : r
  );

  const { error: writeErr } = await db
    .from("batches")
    .update({ recipient_results: updated })
    .eq("id", batchId)
    .eq("user_id", userId);
  if (writeErr) throw writeErr;

  return updated;
}

const MANUAL_STOP_ERROR = "Sequence manually stopped.";

function recipientKey(email: string): string {
  return email.toLowerCase().trim();
}

function collectDescendantBatchIds(
  rootId: string,
  batches: { id: string; parent_batch_id: string | null }[]
): string[] {
  const ids = new Set<string>();
  const queue = [rootId];
  while (queue.length) {
    const id = queue.pop()!;
    if (ids.has(id)) continue;
    ids.add(id);
    for (const batch of batches) {
      if (batch.parent_batch_id === id) queue.push(batch.id);
    }
  }
  return Array.from(ids);
}

/**
 * Stop a recipient from receiving any later emails in this sequence. The root
 * batch is the source of truth for per-recipient stop state, while pending
 * scheduled recipient rows are flipped too so an already-created job won't
 * send before the next UI sync.
 */
export async function stopRecipientSequence(
  userId: string,
  batchId: string,
  email: string
): Promise<RecipientResult[]> {
  const normalizedEmail = recipientKey(email);
  if (!normalizedEmail) throw new Error("Email is required");

  const db = createAdminClient();

  const { data: target, error: targetErr } = await db
    .from("batches")
    .select("id, campaign_id")
    .eq("id", batchId)
    .eq("user_id", userId)
    .single();
  if (targetErr || !target) throw targetErr ?? new Error("Batch not found");

  const { data: batchRows, error: batchesErr } = await db
    .from("batches")
    .select("id, parent_batch_id, recipient_results")
    .eq("campaign_id", target.campaign_id)
    .eq("user_id", userId);
  if (batchesErr) throw batchesErr;

  const rows = (batchRows ?? []) as {
    id: string;
    parent_batch_id: string | null;
    recipient_results: RecipientResult[] | null;
  }[];
  const byId = new Map(rows.map((b) => [b.id, b]));
  let root = byId.get(target.id);
  while (root?.parent_batch_id) {
    const parent = byId.get(root.parent_batch_id);
    if (!parent) break;
    root = parent;
  }
  if (!root) throw new Error("Batch not found");

  const current = Array.isArray(root.recipient_results)
    ? root.recipient_results
    : [];
  const existing = current.find((r) => recipientKey(r.email) === normalizedEmail);
  const stopped: RecipientResult = {
    email: existing?.email || email,
    status: "manually_stopped",
    messageId: existing?.messageId,
    threadId: existing?.threadId,
    mimeMessageId: existing?.mimeMessageId,
    error: MANUAL_STOP_ERROR,
  };
  const updated = existing
    ? current.map((r) => (recipientKey(r.email) === normalizedEmail ? stopped : r))
    : [...current, stopped];

  const { error: writeErr } = await db
    .from("batches")
    .update({ recipient_results: updated })
    .eq("id", root.id)
    .eq("user_id", userId);
  if (writeErr) throw writeErr;

  const descendantIds = collectDescendantBatchIds(root.id, rows);
  const { data: jobs, error: jobsErr } = await db
    .from("send_jobs")
    .select("id")
    .eq("user_id", userId)
    .in("batch_id", descendantIds)
    .in("status", ["pending", "partial_failed", "running"]);
  if (jobsErr) throw jobsErr;

  const jobIds = (jobs ?? []).map((j: { id: string }) => j.id);
  if (jobIds.length) {
    const { error: recipientsErr } = await db
      .from("send_recipients")
      .update({
        status: "manually_stopped",
        last_error: MANUAL_STOP_ERROR,
        last_error_at: new Date().toISOString(),
      })
      .in("job_id", jobIds)
      .eq("email", normalizedEmail)
      .eq("status", "pending");
    if (recipientsErr) throw recipientsErr;
  }

  return updated;
}

/**
 * Persist that drafts were created for this batch. Status only — drafts have
 * no thread/message IDs we can use for reply threading later.
 */
export async function recordDraftsCreated(userId: string, batchId: string): Promise<void> {
  const db = createAdminClient();
  const { error } = await db
    .from("batches")
    .update({ status: "drafted" })
    .eq("id", batchId)
    .eq("user_id", userId);
  if (error) throw error;
}

export async function getSignature(userId: string): Promise<string> {
  const db = createAdminClient();
  const { data, error } = await db
    .from("app_users")
    .select("signature_html")
    .eq("id", userId)
    .single();
  if (error) throw error;
  return data?.signature_html ?? "";
}

export async function setSignature(userId: string, signature: string): Promise<void> {
  const db = createAdminClient();
  const { error } = await db
    .from("app_users")
    .update({ signature_html: signature })
    .eq("id", userId);
  if (error) throw error;
}
