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

      if (scheduledAt) {
        const res = await fetch("/api/send/schedule", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            subject: activeBatch.subject,
            body: activeBatch.body,
            signature,
            contacts: activeBatch.contacts,
            scheduledAt,
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Failed to schedule send.");
        toast.success(`Scheduled ${data.count} email(s) for ${new Date(data.scheduledAt).toLocaleString()}`);
        onBatchUpdate({ status: "scheduled" });
        onScheduled?.();
      } else if (sendMode === "send" || activeBatch.parentBatchId) {
        let parentThreadIds: Record<string, string> | undefined;
        let parentMimeMessageIds: Record<string, string> | undefined;
        if (activeBatch.parentBatchId) {
          const parent = batches.find((b) => b.id === activeBatch.parentBatchId);
          if (parent?.sentResults?.length) {
            parentThreadIds = {};
            parentMimeMessageIds = {};
            for (const r of parent.sentResults) {
              parentThreadIds[r.email] = r.threadId;
              parentMimeMessageIds[r.email] = r.mimeMessageId;
            }
          }
        }
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
          onBatchUpdate({ status: "sent", sentAt: new Date().toISOString(), sentResults: data.results });
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
