import { Contact } from "./gmail";

export interface SentResult {
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
  contacts: Contact[];
  parentBatchId?: string;
  sentResults?: SentResult[];
  status: "active" | "sent" | "scheduled";
  createdAt: string;
  sentAt?: string;
}

export function createBatch(name: string, overrides?: Partial<Batch>): Batch {
  return {
    id: crypto.randomUUID(),
    name,
    subject: "",
    body: "",
    contacts: [{ email: "", firstName: "", company: "" }],
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

  let contacts: Contact[] = [{ email: "", firstName: "", company: "" }];
  if (contactsRaw) {
    try {
      contacts = JSON.parse(contactsRaw);
    } catch {
      // ignore
    }
  }

  const batch = createBatch("Batch 1", { subject, body, contacts });
  return [batch];
}
