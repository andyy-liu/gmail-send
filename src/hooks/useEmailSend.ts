"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Batch, RecipientResult } from "@/lib/batches";
import type { CustomVariable } from "@/lib/variables";
import { checkTemplateTokens } from "@/lib/variables";

interface UseEmailSendOptions {
  activeBatch: Batch | undefined;
  batches: Batch[];
  signature: string;
  scheduledAt: string;
  variables: CustomVariable[];
  onBatchUpdate: (patch: Partial<Batch>) => void;
  onScheduled?: () => void;
}

function getBatchTime(batch: Batch | undefined): string | undefined {
  return batch?.sentAt ?? batch?.scheduledAt;
}

function formatDateTime(value: string) {
  return new Date(value).toLocaleString();
}

function isWeekendDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return false;
  const day = date.getDay();
  return day === 0 || day === 6;
}

function isStoppedRecipient(r: RecipientResult | undefined) {
  return (
    r?.status === "replied" ||
    r?.status === "skipped_replied" ||
    r?.status === "manually_stopped"
  );
}

export function useEmailSend({
  activeBatch,
  batches,
  signature,
  scheduledAt,
  variables,
  onBatchUpdate,
  onScheduled,
}: UseEmailSendOptions) {
  const [isSubmitting, setIsSubmitting] = useState(false);

  const submit = async (sendMode: "draft" | "send") => {
    setIsSubmitting(true);
    try {
      if (!activeBatch) throw new Error("No active batch.");
      if (!activeBatch.subject || !activeBatch.body) throw new Error("Subject and body are required.");

      const { unknown, disabled } = checkTemplateTokens(
        activeBatch.subject,
        activeBatch.body,
        variables
      );
      if (disabled.length) {
        throw new Error(
          `Cannot send: template uses disabled variable${disabled.length === 1 ? "" : "s"} ${disabled.map((n) => `{{${n}}}`).join(", ")}. Re-enable in the Variables panel or remove the reference.`
        );
      }
      if (unknown.length) {
        throw new Error(
          `Cannot send: template references unknown variable${unknown.length === 1 ? "" : "s"} ${unknown.map((n) => `{{${n}}}`).join(", ")}.`
        );
      }

      // Follow-ups always send to the parent's current contacts. This keeps
      // the recipient list authoritative on the root node and avoids the
      // snapshot drift bug from copying contacts at creation time.
      const parent = activeBatch.parentBatchId
        ? batches.find((b) => b.id === activeBatch.parentBatchId)
        : undefined;
      let rootBatch = activeBatch;
      while (rootBatch.parentBatchId) {
        const ancestor = batches.find((b) => b.id === rootBatch.parentBatchId);
        if (!ancestor) break;
        rootBatch = ancestor;
      }
      const stoppedEmails = new Set(
        (rootBatch.recipientResults ?? [])
          .filter(isStoppedRecipient)
          .map((r) => r.email.toLowerCase().trim())
      );
      const sendContacts = activeBatch.parentBatchId
        ? (parent?.contacts ?? []).filter(
            (c) => !stoppedEmails.has(c.email.toLowerCase().trim())
          )
        : activeBatch.contacts;

      if (sendContacts.length === 0) throw new Error("At least one contact is required.");
      for (let i = 0; i < sendContacts.length; i++) {
        const c = sendContacts[i];
        if (!c.email || !c.firstName || !c.company) {
          throw new Error(`Row ${i + 1} is missing fields. All fields are required.`);
        }
      }

      // Resolve follow-up parent thread info up front; used in both the
      // immediate-send and scheduled-send branches so reply threading is
      // preserved either way. We include skipped_replied entries because we
      // copy the threadId forward on skip so deeper follow-ups can still
      // detect the reply via their own thread fetch.
      let parentThreadIds: Record<string, string> | undefined;
      let parentMimeMessageIds: Record<string, string> | undefined;
      if (activeBatch.parentBatchId) {
        if (parent?.status === "sent" && parent?.recipientResults?.length) {
          parentThreadIds = {};
          parentMimeMessageIds = {};
          for (const r of parent.recipientResults) {
            if (r.threadId && r.mimeMessageId) {
              parentThreadIds[r.email] = r.threadId;
              parentMimeMessageIds[r.email] = r.mimeMessageId;
            }
          }
        }
      }

      const effectiveScheduledAt = scheduledAt;

      if (effectiveScheduledAt) {
        const scheduledDate = new Date(effectiveScheduledAt);
        if (Number.isNaN(scheduledDate.getTime()) || scheduledDate <= new Date()) {
          throw new Error("Schedule time must be in the future.");
        }

        if (activeBatch.parentBatchId) {
          if (!parent) throw new Error("Previous email not found.");
          if (parent.status !== "scheduled" && parent.status !== "sent") {
            throw new Error("Schedule the previous email before scheduling this follow-up.");
          }
          const parentTime = getBatchTime(parent);
          if (!parentTime) {
            throw new Error("Previous email needs a scheduled or sent time first.");
          }
          if (scheduledDate <= new Date(parentTime)) {
            throw new Error(`Follow-up must be after the previous email (${formatDateTime(parentTime)}).`);
          }
        }

        const nextFollowUp = batches.find((b) => b.parentBatchId === activeBatch.id);
        const nextTime = getBatchTime(nextFollowUp);
        if (nextTime && scheduledDate >= new Date(nextTime)) {
          throw new Error(`This email must be before its follow-up (${formatDateTime(nextTime)}).`);
        }

        if (isWeekendDate(effectiveScheduledAt)) {
          toast.warning("This send time falls on a weekend.");
        }

        // If this batch already has a scheduled job, cancel it first so we
        // don't end up with two jobs sending to the same recipients.
        if (activeBatch.scheduledJobId) {
          await fetch("/api/send/schedule", {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id: activeBatch.scheduledJobId }),
          });
        }

        const res = await fetch("/api/send/schedule", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            batchId: activeBatch.id,
            subject: activeBatch.subject,
            body: activeBatch.body,
            signature,
            contacts: sendContacts,
            scheduledAt: scheduledDate.toISOString(),
            ...(parentThreadIds && { parentThreadIds, parentMimeMessageIds }),
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Failed to schedule send.");
        toast.success(`Scheduled ${data.count} email(s) for ${new Date(data.scheduledAt).toLocaleString()}`);
        onBatchUpdate({ status: "scheduled", scheduledAt: data.scheduledAt, scheduledJobId: data.jobId });
        onScheduled?.();
      } else if (sendMode === "send") {
        const res = await fetch("/api/send/now", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            batchId: activeBatch.id,
            subject: activeBatch.subject,
            body: activeBatch.body,
            signature,
            contacts: sendContacts,
            ...(parentThreadIds && { parentThreadIds, parentMimeMessageIds }),
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Failed to send emails.");

        const results = (data.results ?? []) as RecipientResult[];
        const sentCount = results.filter((r) => r.status === "sent").length;
        const failedCount = results.filter((r) => r.status === "failed").length;
        const skippedCount = results.filter((r) => r.status === "skipped_replied").length;

        if (failedCount > 0) {
          toast.error(
            `Sent ${sentCount}, ${failedCount} failed${skippedCount ? `, ${skippedCount} skipped` : ""}.`
          );
        } else if (skippedCount > 0) {
          toast.success(`Sent ${sentCount}, ${skippedCount} skipped (already replied).`);
        } else {
          toast.success(`Sent ${sentCount} email(s) successfully!`);
        }
        // Always persist the recipientResults so the UI can show per-row
        // status. Mark the batch as 'sent' whenever the run completed
        // (failures included), so the node locks per the user's spec.
        onBatchUpdate({
          status: "sent",
          sentAt: new Date().toISOString(),
          recipientResults: results,
        });
      } else {
        const res = await fetch("/api/drafts/create", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            batchId: activeBatch.id,
            subject: activeBatch.subject,
            body: activeBatch.body,
            signature,
            contacts: sendContacts,
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Failed to create drafts.");
        if (data.errors?.length > 0) {
          toast.error(`Created ${data.results?.length || 0} drafts, failed on ${data.errors.length}.`);
          console.error("Draft errors:", data.errors);
        } else {
          toast.success(`Created ${data.results.length} draft(s) in Gmail!`);
          // Status "drafted" — recipientResults are not stored because draft
          // IDs cannot be used for reply threading (no delivered Message-ID
          // or threadId yet).
          onBatchUpdate({ status: "drafted" });
        }
      }
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "An unknown error occurred");
    } finally {
      setIsSubmitting(false);
    }
  };

  return { isSubmitting, submit };
}
