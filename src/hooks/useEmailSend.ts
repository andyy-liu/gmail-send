"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Batch, RecipientResult } from "@/lib/batches";

interface UseEmailSendOptions {
  activeBatch: Batch | undefined;
  batches: Batch[];
  signature: string;
  scheduledAt: string;
  onBatchUpdate: (patch: Partial<Batch>) => void;
  onScheduled?: () => void;
}

export function useEmailSend({
  activeBatch,
  batches,
  signature,
  scheduledAt,
  onBatchUpdate,
  onScheduled,
}: UseEmailSendOptions) {
  const [isSubmitting, setIsSubmitting] = useState(false);

  const submit = async (sendMode: "draft" | "send") => {
    setIsSubmitting(true);
    try {
      if (!activeBatch) throw new Error("No active batch.");
      if (!activeBatch.subject || !activeBatch.body) throw new Error("Subject and body are required.");

      // Follow-ups always send to the parent's current contacts. This keeps
      // the recipient list authoritative on the root node and avoids the
      // snapshot drift bug from copying contacts at creation time.
      const parent = activeBatch.parentBatchId
        ? batches.find((b) => b.id === activeBatch.parentBatchId)
        : undefined;
      const sendContacts = activeBatch.parentBatchId
        ? parent?.contacts ?? []
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
        // A follow-up with a delay must wait for the parent to be sent.
        // Without parent.sentAt we cannot compute the scheduled time and we
        // would silently send immediately — block instead.
        if (activeBatch.scheduledDelay && !parent?.sentAt) {
          throw new Error("Cannot send follow-up before the parent email has been sent.");
        }

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

      // For follow-ups with a scheduled delay, compute the effective send time from the parent's sentAt.
      let effectiveScheduledAt = scheduledAt;
      if (!effectiveScheduledAt && activeBatch.parentBatchId && activeBatch.scheduledDelay) {
        const parent = batches.find((b) => b.id === activeBatch.parentBatchId);
        if (parent?.sentAt) {
          const delayMs =
            activeBatch.scheduledDelay.unit === "days"
              ? activeBatch.scheduledDelay.value * 24 * 60 * 60 * 1000
              : activeBatch.scheduledDelay.value * 60 * 60 * 1000;
          const computedAt = new Date(new Date(parent.sentAt).getTime() + delayMs);
          if (computedAt > new Date()) {
            effectiveScheduledAt = computedAt.toISOString();
          }
        }
      }

      if (effectiveScheduledAt) {
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
            subject: activeBatch.subject,
            body: activeBatch.body,
            signature,
            contacts: sendContacts,
            scheduledAt: effectiveScheduledAt,
            ...(parentThreadIds && { parentThreadIds, parentMimeMessageIds }),
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Failed to schedule send.");
        toast.success(`Scheduled ${data.count} email(s) for ${new Date(data.scheduledAt).toLocaleString()}`);
        onBatchUpdate({ status: "scheduled", scheduledJobId: data.jobId });
        onScheduled?.();
      } else if (sendMode === "send" || activeBatch.parentBatchId) {
        const res = await fetch("/api/send/now", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
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
