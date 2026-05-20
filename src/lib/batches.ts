import { Contact } from "./gmail";

export interface ContactRow extends Contact {
  id: string;
  customFields: Record<string, string>;
}

/**
 * - sent: delivered successfully
 * - failed: send attempt failed
 * - skipped_replied: didn't send this (follow-up) because recipient had already replied
 * - replied: we sent it AND they replied — sequence is stopped from here on
 */
export type RecipientResultStatus = "sent" | "failed" | "skipped_replied" | "replied";

export interface RecipientResult {
  email: string;
  status: RecipientResultStatus;
  // Present for status === "sent"; also preserved on "skipped_replied" so
  // downstream follow-ups can still resolve the parent thread/message-id.
  messageId?: string;
  threadId?: string;
  mimeMessageId?: string;
  // Present for "failed" and "skipped_replied".
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
  /** Set after a successful schedule; used to poll per-recipient progress. */
  scheduledJobId?: string;
}
