import { google } from "googleapis";

export interface Contact {
  email: string;
  firstName: string;
  company: string;
}

/** Escape HTML entities in user-supplied values before injecting into HTML body */
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Replace {{FirstName}}, {{Company}}, and {{Signature}} in both subject (plain) and HTML body */
function processTemplate(template: string, contact: Contact, isHtml = false, signatureHtml = ""): string {
  const firstName = isHtml ? escapeHtml(contact.firstName) : contact.firstName;
  const company = isHtml ? escapeHtml(contact.company) : contact.company;
  return template
    .replace(/\{\{FirstName\}\}/g, firstName)
    .replace(/\{\{Company\}\}/g, company)
    .replace(/\{\{Signature\}\}/g, isHtml ? cleanListHtml(signatureHtml) : "");
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

  const fromAddr = fromEmail ?? "me";
  const fromHeader = fromName
    ? `From: =?UTF-8?B?${Buffer.from(fromName).toString("base64")}?= <${fromAddr}>`
    : `From: ${fromAddr}`;

  const message = [
    fromHeader,
    `To: ${to}`,
    `Subject: =?UTF-8?B?${Buffer.from(subject).toString("base64")}?=`,
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
  const auth = new google.auth.OAuth2();
  auth.setCredentials({ access_token: accessToken });

  const gmail = google.gmail({ version: "v1", auth });

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
  let finalMimeMessageId = mimeMessageId;
  if (res.data.id) {
    try {
      const meta = await gmail.users.messages.get({
        userId: "me",
        id: res.data.id,
        format: "metadata",
      });
      const headers = meta.data.payload?.headers ?? [];
      const header = headers.find((h) => h.name?.toLowerCase() === "message-id");
      if (header?.value) finalMimeMessageId = header.value;
    } catch (err) {
      console.error("[sendMessage] failed to fetch Message-ID from Gmail:", err);
    }
  }

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
  const auth = new google.auth.OAuth2();
  auth.setCredentials({ access_token: accessToken });

  const gmail = google.gmail({ version: "v1", auth });

  const subject = processTemplate(subjectTemplate, contact, false);
  const body = processTemplate(bodyTemplate, contact, true, signatureHtml ?? "");
  const mimeMessageId = `<${crypto.randomUUID()}@mail.gmail.com>`;

  const raw = createMimeMessage(contact.email, subject, body, mimeMessageId, [
    `In-Reply-To: ${inReplyToMimeMessageId}`,
    `References: ${inReplyToMimeMessageId}`,
  ], fromName, fromEmail);

  const res = await gmail.users.messages.send({
    userId: "me",
    requestBody: { raw, threadId },
  });

  return { id: res.data.id, threadId: res.data.threadId, mimeMessageId };
}

export async function createDraft(
  accessToken: string,
  contact: Contact,
  subjectTemplate: string,
  bodyTemplate: string,
  signatureHtml?: string
) {
  const auth = new google.auth.OAuth2();
  auth.setCredentials({ access_token: accessToken });

  const gmail = google.gmail({ version: "v1", auth });

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
