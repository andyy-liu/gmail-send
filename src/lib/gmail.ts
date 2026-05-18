import { google } from "googleapis";

export interface Contact {
  email: string;
  firstName: string;
  company: string;
  customFields?: Record<string, string>;
}

/** Strip CR and LF to prevent MIME header injection */
function sanitizeHeader(value: string): string {
  return value.replace(/[\r\n]/g, "");
}

/** Escape HTML entities in user-supplied values before injecting into HTML body */
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Replace {{FirstName}}, {{Company}}, {{Signature}}, and any user-defined
 * {{Variable}} tokens. Custom field values come from `contact.customFields`
 * and are escaped the same way as built-ins when rendering HTML.
 */
function processTemplate(template: string, contact: Contact, isHtml = false, signatureHtml = ""): string {
  const firstName = isHtml ? escapeHtml(contact.firstName) : contact.firstName;
  const company = isHtml ? escapeHtml(contact.company) : contact.company;
  const customFields = contact.customFields ?? {};

  return template.replace(/\{\{\s*([A-Za-z][A-Za-z0-9_]*)\s*\}\}/g, (match, name: string) => {
    if (name === "FirstName") return firstName;
    if (name === "Company") return company;
    if (name === "Signature") return isHtml ? cleanListHtml(signatureHtml) : "";
    if (Object.prototype.hasOwnProperty.call(customFields, name)) {
      const value = customFields[name] ?? "";
      return isHtml ? escapeHtml(value) : value;
    }
    return match;
  });
}

/**
 * Tiptap wraps list item content in <p> tags which carry margin in Gmail.
 * This strips those wrappers so list items render without extra spacing.
 */
function cleanListHtml(html: string): string {
  return html
    .replace(/<li><p>/gi, "<li>")
    .replace(/<\/p><\/li>/gi, "</li>");
}

function getGmailClient(accessToken: string) {
  const auth = new google.auth.OAuth2();
  auth.setCredentials({ access_token: accessToken });
  return google.gmail({ version: "v1", auth });
}

async function getDeliveredMessageId(
  gmail: ReturnType<typeof getGmailClient>,
  gmailMessageId: string | null | undefined,
  fallbackMimeMessageId: string,
  logContext: string
): Promise<string> {
  if (!gmailMessageId) return fallbackMimeMessageId;
  try {
    const meta = await gmail.users.messages.get({
      userId: "me",
      id: gmailMessageId,
      format: "metadata",
      metadataHeaders: ["Message-ID"],
    });
    const headers = meta.data.payload?.headers ?? [];
    const header = headers.find((h) => h.name?.toLowerCase() === "message-id");
    return header?.value || fallbackMimeMessageId;
  } catch (err) {
    console.error(`[${logContext}] failed to fetch Message-ID from Gmail:`, err);
    return fallbackMimeMessageId;
  }
}

function createMimeMessage(
  to: string,
  subject: string,
  htmlBody: string,
  mimeMessageId: string,
  extraHeaders: string[] = [],
  fromName?: string,
  fromEmail?: string
): string {
  const wrappedHtml = [
    `<!DOCTYPE html>`,
    `<html>`,
    `<head><meta charset="UTF-8"></head>`,
    `<body>`,
    cleanListHtml(htmlBody),
    `</body></html>`,
  ].join("\n");

  const safeFrom = sanitizeHeader(fromEmail ?? "me");
  const safeTo = sanitizeHeader(to);
  const safeSubject = sanitizeHeader(subject);
  const fromHeader = fromName
    ? `From: =?UTF-8?B?${Buffer.from(sanitizeHeader(fromName)).toString("base64")}?= <${safeFrom}>`
    : `From: ${safeFrom}`;

  const message = [
    fromHeader,
    `To: ${safeTo}`,
    `Subject: =?UTF-8?B?${Buffer.from(safeSubject).toString("base64")}?=`,
    `Message-ID: ${mimeMessageId}`,
    ...extraHeaders,
    `MIME-Version: 1.0`,
    `Content-Type: text/html; charset=UTF-8`,
    `Content-Transfer-Encoding: base64`,
    ``,
    Buffer.from(wrappedHtml, "utf-8").toString("base64"),
  ].join("\r\n");

  // base64url encode the entire MIME message
  return Buffer.from(message)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export async function sendMessage(
  accessToken: string,
  contact: Contact,
  subjectTemplate: string,
  bodyTemplate: string,
  signatureHtml?: string,
  fromName?: string,
  fromEmail?: string
): Promise<{ id?: string | null; threadId?: string | null; mimeMessageId: string }> {
  const gmail = getGmailClient(accessToken);

  const subject = processTemplate(subjectTemplate, contact, false);
  const body = processTemplate(bodyTemplate, contact, true, signatureHtml ?? "");
  const mimeMessageId = `<${crypto.randomUUID()}@mail.gmail.com>`;

  const rawMessage = createMimeMessage(contact.email, subject, body, mimeMessageId, [], fromName, fromEmail);

  const res = await gmail.users.messages.send({
    userId: "me",
    requestBody: { raw: rawMessage },
  });

  // Gmail may replace our Message-ID header on delivery. Fetch the real one
  // so In-Reply-To on follow-ups matches what recipients actually received.
  const finalMimeMessageId = await getDeliveredMessageId(gmail, res.data.id, mimeMessageId, "sendMessage");

  return { id: res.data.id, threadId: res.data.threadId, mimeMessageId: finalMimeMessageId };
}

export async function sendReply(
  accessToken: string,
  contact: Contact,
  threadId: string,
  inReplyToMimeMessageId: string,
  subjectTemplate: string,
  bodyTemplate: string,
  signatureHtml?: string,
  fromName?: string,
  fromEmail?: string
): Promise<{ id?: string | null; threadId?: string | null; mimeMessageId: string }> {
  const gmail = getGmailClient(accessToken);

  const subject = processTemplate(subjectTemplate, contact, false);
  const body = processTemplate(bodyTemplate, contact, true, signatureHtml ?? "");
  const mimeMessageId = `<${crypto.randomUUID()}@mail.gmail.com>`;

  const safeInReplyTo = sanitizeHeader(inReplyToMimeMessageId);
  const raw = createMimeMessage(contact.email, subject, body, mimeMessageId, [
    `In-Reply-To: ${safeInReplyTo}`,
    `References: ${safeInReplyTo}`,
  ], fromName, fromEmail);

  const res = await gmail.users.messages.send({
    userId: "me",
    requestBody: { raw, threadId },
  });

  const finalMimeMessageId = await getDeliveredMessageId(gmail, res.data.id, mimeMessageId, "sendReply");

  return { id: res.data.id, threadId: res.data.threadId, mimeMessageId: finalMimeMessageId };
}

/**
 * Returns true if the recipient sent at least one message in the given thread.
 * Used to skip follow-ups to recipients who have already replied. On API
 * errors we return false so a transient failure does not silently drop sends.
 */
export async function hasRecipientReplied(
  accessToken: string,
  threadId: string,
  recipientEmail: string
): Promise<boolean> {
  const gmail = getGmailClient(accessToken);
  const target = recipientEmail.toLowerCase().trim();
  try {
    const thread = await gmail.users.threads.get({
      userId: "me",
      id: threadId,
      format: "metadata",
      metadataHeaders: ["From"],
    });
    for (const msg of thread.data.messages ?? []) {
      const fromHeader =
        msg.payload?.headers?.find((h) => h.name?.toLowerCase() === "from")?.value ?? "";
      const match = fromHeader.match(/<([^>]+)>/);
      const fromEmail = (match ? match[1] : fromHeader).trim().toLowerCase();
      if (fromEmail && fromEmail === target) return true;
    }
    return false;
  } catch (err) {
    console.error("[hasRecipientReplied] error:", err);
    return false;
  }
}

export async function createDraft(
  accessToken: string,
  contact: Contact,
  subjectTemplate: string,
  bodyTemplate: string,
  signatureHtml?: string
) {
  const gmail = getGmailClient(accessToken);

  const subject = processTemplate(subjectTemplate, contact, false);
  const body = processTemplate(bodyTemplate, contact, true, signatureHtml ?? "");

  const mimeMessageId = `<${crypto.randomUUID()}@mail.gmail.com>`;
  const rawMessage = createMimeMessage(contact.email, subject, body, mimeMessageId);

  const res = await gmail.users.drafts.create({
    userId: "me",
    requestBody: {
      message: {
        raw: rawMessage,
      },
    },
  });

  return res.data;
}
