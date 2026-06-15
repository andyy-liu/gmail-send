import { Contact } from "./gmail";
import type { EmailAttachment } from "./attachments";

export interface ContactRow extends Contact {
  id: string;
  customFields: Record<string, string>;
}

/**
 * - sent: delivered successfully
 * - failed: send attempt failed
 * - skipped_replied: didn't send this (follow-up) because recipient had already replied
 * - replied: we sent it AND they replied — sequence is stopped from here on
 * - manually_stopped: user stopped this recipient's sequence
 */
export type RecipientResultStatus =
  | "sent"
  | "failed"
  | "skipped_replied"
  | "replied"
  | "manually_stopped";

export interface RecipientResult {
  email: string;
  status: RecipientResultStatus;
  // Present for status === "sent"; also preserved on "skipped_replied" so
  // downstream follow-ups can still resolve the parent thread/message-id.
  messageId?: string;
  threadId?: string;
  mimeMessageId?: string;
  // Present for "failed", "skipped_replied", and "manually_stopped".
  error?: string;
}

export interface Batch {
  id: string;
  name: string;
  subject: string;
  body: string;
  contacts: ContactRow[];
  parentBatchId?: string;
  recipientResults?: RecipientResult[];
  status: "active" | "drafted" | "sent" | "scheduled";
  createdAt: string;
  sentAt?: string;
  // Canvas fields
  scheduledAt?: string;
  scheduledDelay?: { value: number; unit: "days" | "hours" };
  attachment?: EmailAttachment | null;
  /** Set after a successful schedule; used to poll per-recipient progress. */
  scheduledJobId?: string;
}

export function findRootBatch(
  batch: Batch | undefined,
  batches: Batch[],
): Batch | undefined {
  let current = batch;
  const visited = new Set<string>();

  while (current?.parentBatchId && !visited.has(current.id)) {
    visited.add(current.id);
    const parent = batches.find((b) => b.id === current?.parentBatchId);
    if (!parent) break;
    current = parent;
  }

  return current;
}

export function inheritedContactsForBatch(
  batch: Batch | undefined,
  batches: Batch[],
): ContactRow[] {
  if (!batch) return [];
  if (!batch.parentBatchId) return batch.contacts;
  return findRootBatch(batch, batches)?.contacts ?? [];
}

type StoppedRecipientResult = RecipientResult & {
  status: "replied" | "skipped_replied" | "manually_stopped";
};

export function isStoppedRecipientResult(
  result: RecipientResult | undefined,
): result is StoppedRecipientResult {
  return (
    result?.status === "replied" ||
    result?.status === "skipped_replied" ||
    result?.status === "manually_stopped"
  );
}

export function sequenceBatchesForBatch(
  batch: Batch | undefined,
  batches: Batch[],
): Batch[] {
  const root = findRootBatch(batch, batches);
  if (!root) return [];

  const sequence: Batch[] = [];
  const visited = new Set<string>();
  const queue = [root.id];
  while (queue.length) {
    const id = queue.shift()!;
    if (visited.has(id)) continue;
    visited.add(id);
    const current = batches.find((b) => b.id === id);
    if (!current) continue;
    sequence.push(current);
    for (const child of batches) {
      if (child.parentBatchId === id) queue.push(child.id);
    }
  }

  return sequence;
}

export function stoppedEmailsForBatch(
  batch: Batch | undefined,
  batches: Batch[],
): Set<string> {
  const emails = new Set<string>();
  for (const sequenceBatch of sequenceBatchesForBatch(batch, batches)) {
    for (const result of sequenceBatch.recipientResults ?? []) {
      if (isStoppedRecipientResult(result) && result.email) {
        emails.add(result.email.toLowerCase().trim());
      }
    }
  }
  return emails;
}

export function stoppedResultsForBatch(
  batch: Batch | undefined,
  batches: Batch[],
): RecipientResult[] {
  const byEmail = new Map<string, StoppedRecipientResult>();
  const priority: Record<StoppedRecipientResult["status"], number> = {
    skipped_replied: 1,
    replied: 2,
    manually_stopped: 3,
  };

  for (const sequenceBatch of sequenceBatchesForBatch(batch, batches)) {
    for (const result of sequenceBatch.recipientResults ?? []) {
      if (!isStoppedRecipientResult(result) || !result.email) continue;
      const key = result.email.toLowerCase().trim();
      const existing = byEmail.get(key);
      if (
        !existing ||
        priority[result.status] > priority[existing.status]
      ) {
        byEmail.set(key, result);
      }
    }
  }

  return Array.from(byEmail.values());
}
