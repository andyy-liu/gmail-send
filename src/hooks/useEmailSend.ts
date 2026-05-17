"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Batch } from "@/lib/batches";

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
      if (activeBatch.contacts.length === 0) throw new Error("At least one contact is required.");
      for (let i = 0; i < activeBatch.contacts.length; i++) {
        const c = activeBatch.contacts[i];
        if (!c.email || !c.firstName || !c.company) {
          throw new Error(`Row ${i + 1} is missing fields. All fields are required.`);
        }
      }

      // Resolve follow-up parent thread info up front; used in both the
      // immediate-send and scheduled-send branches so reply threading is
      // preserved either way.
      let parentThreadIds: Record<string, string> | undefined;
      let parentMimeMessageIds: Record<string, string> | undefined;
      if (activeBatch.parentBatchId) {
        const parent = batches.find((b) => b.id === activeBatch.parentBatchId);

        // A follow-up with a delay must wait for the parent to be sent.
        // Without parent.sentAt we cannot compute the scheduled time and we
        // would silently send immediately — block instead.
        if (activeBatch.scheduledDelay && !parent?.sentAt) {
          throw new Error("Cannot send follow-up before the parent email has been sent.");
        }

        if (parent?.status === "sent" && parent?.sentResults?.length) {
          parentThreadIds = {};
          parentMimeMessageIds = {};
          for (const r of parent.sentResults) {
            parentThreadIds[r.email] = r.threadId;
            parentMimeMessageIds[r.email] = r.mimeMessageId;
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
        const res = await fetch("/api/send/schedule", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            subject: activeBatch.subject,
            body: activeBatch.body,
            signature,
            contacts: activeBatch.contacts,
            scheduledAt: effectiveScheduledAt,
            ...(parentThreadIds && { parentThreadIds, parentMimeMessageIds }),
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Failed to schedule send.");
        toast.success(`Scheduled ${data.count} email(s) for ${new Date(data.scheduledAt).toLocaleString()}`);
        onBatchUpdate({ status: "scheduled" });
        onScheduled?.();
      } else if (sendMode === "send" || activeBatch.parentBatchId) {
        const res = await fetch("/api/send/now", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            subject: activeBatch.subject,
            body: activeBatch.body,
            signature,
            contacts: activeBatch.contacts,
            ...(parentThreadIds && { parentThreadIds, parentMimeMessageIds }),
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Failed to send emails.");
        if (data.errors?.length > 0) {
          toast.error(`Sent ${data.results?.length || 0} email(s), failed on ${data.errors.length}.`);
          console.error("Send errors:", data.errors);
        } else {
          toast.success(`Sent ${data.results.length} email(s) successfully!`);
          onBatchUpdate({ status: "sent", sentAt: new Date().toISOString(), sentResults: data.results });
        }
      } else {
        const res = await fetch("/api/drafts/create", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            subject: activeBatch.subject,
            body: activeBatch.body,
            signature,
            contacts: activeBatch.contacts,
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Failed to create drafts.");
        if (data.errors?.length > 0) {
          toast.error(`Created ${data.results?.length || 0} drafts, failed on ${data.errors.length}.`);
          console.error("Draft errors:", data.errors);
        } else {
          toast.success(`Created ${data.results.length} draft(s) in Gmail!`);
          // Status "drafted" — sentResults are not stored because draft IDs cannot be
          // used for reply threading (no delivered Message-ID or threadId yet).
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
