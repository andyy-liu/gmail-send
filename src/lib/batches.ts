import { Contact } from "./gmail";

export interface ContactRow extends Contact {
  id: string;
}

export type RecipientResultStatus = "sent" | "failed" | "skipped_replied";

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

// Legacy shape kept only for the one-shot localStorage migration in useBatches.
export interface LegacySentResult {
  email: string;
  messageId: string;
  threadId: string;
  mimeMessageId: string;
}

export interface Batch {
  id: string;
  name: string;
  subject: string;
  body: string;
  contacts: ContactRow[];
  parentBatchId?: string;
  recipientResults?: RecipientResult[];
  /** Legacy field — migrated to recipientResults on load. */
  sentResults?: LegacySentResult[];
  status: "active" | "drafted" | "sent" | "scheduled";
  createdAt: string;
  sentAt?: string;
  // Canvas fields
  scheduledAt?: string;
  scheduledDelay?: { value: number; unit: "days" | "hours" };
  /** Set after a successful schedule; used to poll per-recipient progress. */
  scheduledJobId?: string;
}

export function createBatch(name: string, overrides?: Partial<Batch>): Batch {
  return {
    id: crypto.randomUUID(),
    name,
    subject: "",
    body: "",
    contacts: [{ id: crypto.randomUUID(), email: "", firstName: "", company: "" }],
    status: "active",
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

/**
 * Reads legacy localStorage keys (subject, body, contacts) and returns a seeded
 * Batch[] if legacy data exists and batches haven't been created yet. Returns null
 * if already migrated or running server-side.
 */
export function migrateLegacyData(): Batch[] | null {
  if (typeof window === "undefined") return null;
  if (localStorage.getItem("gmailsend_batches") !== null) return null;

  const subject = localStorage.getItem("gmailsend_subject") ?? "";
  const body = localStorage.getItem("gmailsend_body") ?? "";
  const contactsRaw = localStorage.getItem("gmailsend_contacts");

  let contacts: ContactRow[] = [{ id: crypto.randomUUID(), email: "", firstName: "", company: "" }];
  if (contactsRaw) {
    try {
      const parsed: Contact[] = JSON.parse(contactsRaw);
      contacts = parsed.map((c) => ({ id: crypto.randomUUID(), ...c }));
    } catch {
      // ignore
    }
  }

  const batch = createBatch("Batch 1", { subject, body, contacts });
  return [batch];
}
