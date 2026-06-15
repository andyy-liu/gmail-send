import { google } from "googleapis";
import type { PreparedEmailAttachment } from "./attachments";

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

interface InlineImage {
  cid: string;
  contentType: string;
  base64: string;
}

/**
 * Find <img src="data:image/...;base64,..."> occurrences, replace each with a
 * cid: reference, and return the rewritten HTML alongside the extracted images.
 * The MIME builder then attaches the images as inline parts in multipart/related,
 * which is what Gmail/Outlook/Apple Mail use to render inline images reliably.
 */
function extractInlineImages(html: string): { html: string; images: InlineImage[] } {
  const images: InlineImage[] = [];
  const rewritten = html.replace(
    /src=(["'])data:(image\/[a-zA-Z0-9.+-]+);base64,([^"']+)\1/g,
    (_match, quote: string, contentType: string, base64: string) => {
      const cid = `img-${crypto.randomUUID()}@gmailsend`;
      images.push({ cid, contentType, base64 });
      return `src=${quote}cid:${cid}${quote}`;
    }
  );
  return { html: rewritten, images };
}

/** Split base64 into 76-char lines as required by RFC 2045 for MIME bodies. */
function chunkBase64(b64: string): string {
  return b64.replace(/(.{76})/g, "$1\r\n");
}

function encodeMimeParameter(value: string): string {
  const cleaned = sanitizeHeader(value).trim() || "attachment";
  const encoded = encodeURIComponent(cleaned).replace(
    /['()*!]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`
  );
  return `UTF-8''${encoded}`;
}

function createHtmlPart(wrappedHtml: string, images: InlineImage[]): string[] {
  if (images.length === 0) {
    return [
      `Content-Type: text/html; charset=UTF-8`,
      `Content-Transfer-Encoding: base64`,
      ``,
      chunkBase64(Buffer.from(wrappedHtml, "utf-8").toString("base64")),
    ];
  }

  const boundary = `=_related_${crypto.randomUUID()}`;
  const parts: string[] = [
    `Content-Type: multipart/related; boundary="${boundary}"; type="text/html"`,
    ``,
    `--${boundary}`,
    `Content-Type: text/html; charset=UTF-8`,
    `Content-Transfer-Encoding: base64`,
    ``,
    chunkBase64(Buffer.from(wrappedHtml, "utf-8").toString("base64")),
  ];
  for (const img of images) {
    const filenameExt = img.contentType.split("/")[1]?.split("+")[0] ?? "img";
    parts.push(
      `--${boundary}`,
      `Content-Type: ${img.contentType}`,
      `Content-Transfer-Encoding: base64`,
      `Content-ID: <${img.cid}>`,
      `Content-Disposition: inline; filename="image.${filenameExt}"`,
      ``,
      chunkBase64(img.base64.replace(/\s+/g, ""))
    );
  }
  parts.push(`--${boundary}--`);
  return parts;
}

function createAttachmentPart(attachment: PreparedEmailAttachment): string[] {
  const encodedFilename = encodeMimeParameter(attachment.name);
  return [
    `Content-Type: application/pdf; name*=${encodedFilename}`,
    `Content-Transfer-Encoding: base64`,
    `Content-Disposition: attachment; filename*=${encodedFilename}`,
    ``,
    chunkBase64(attachment.base64.replace(/\s+/g, "")),
  ];
}

function createMimeMessage(
  to: string,
  subject: string,
  htmlBody: string,
  mimeMessageId: string,
  extraHeaders: string[] = [],
  fromName?: string,
  fromEmail?: string,
  attachment?: PreparedEmailAttachment | null
): string {
  const { html: rewrittenBody, images } = extractInlineImages(cleanListHtml(htmlBody));

  const wrappedHtml = [
    `<!DOCTYPE html>`,
    `<html>`,
    `<head><meta charset="UTF-8"></head>`,
    `<body>`,
    rewrittenBody,
    `</body></html>`,
  ].join("\n");

  const safeFrom = sanitizeHeader(fromEmail ?? "me");
  const safeTo = sanitizeHeader(to);
  const safeSubject = sanitizeHeader(subject);
  const fromHeader = fromName
    ? `From: =?UTF-8?B?${Buffer.from(sanitizeHeader(fromName)).toString("base64")}?= <${safeFrom}>`
    : `From: ${safeFrom}`;

  const commonHeaders = [
    fromHeader,
    `To: ${safeTo}`,
    `Subject: =?UTF-8?B?${Buffer.from(safeSubject).toString("base64")}?=`,
    `Message-ID: ${mimeMessageId}`,
    ...extraHeaders,
    `MIME-Version: 1.0`,
  ];

  const htmlPart = createHtmlPart(wrappedHtml, images);
  let message: string;
  if (!attachment) {
    message = [
      ...commonHeaders,
      ...htmlPart,
    ].join("\r\n");
  } else {
    const boundary = `=_mixed_${crypto.randomUUID()}`;
    message = [
      ...commonHeaders,
      `Content-Type: multipart/mixed; boundary="${boundary}"`,
      ``,
      `--${boundary}`,
      ...htmlPart,
      `--${boundary}`,
      ...createAttachmentPart(attachment),
      `--${boundary}--`,
      ``,
    ].join("\r\n");
  }

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
  fromEmail?: string,
  attachment?: PreparedEmailAttachment | null
): Promise<{ id?: string | null; threadId?: string | null; mimeMessageId: string }> {
  const gmail = getGmailClient(accessToken);

  const subject = processTemplate(subjectTemplate, contact, false);
  const body = processTemplate(bodyTemplate, contact, true, signatureHtml ?? "");
  const mimeMessageId = `<${crypto.randomUUID()}@mail.gmail.com>`;

  const rawMessage = createMimeMessage(contact.email, subject, body, mimeMessageId, [], fromName, fromEmail, attachment);

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
  fromEmail?: string,
  attachment?: PreparedEmailAttachment | null
): Promise<{ id?: string | null; threadId?: string | null; mimeMessageId: string }> {
  const gmail = getGmailClient(accessToken);

  const subject = processTemplate(subjectTemplate, contact, false);
  const body = processTemplate(bodyTemplate, contact, true, signatureHtml ?? "");
  const mimeMessageId = `<${crypto.randomUUID()}@mail.gmail.com>`;

  const safeInReplyTo = sanitizeHeader(inReplyToMimeMessageId);
  const raw = createMimeMessage(contact.email, subject, body, mimeMessageId, [
    `In-Reply-To: ${safeInReplyTo}`,
    `References: ${safeInReplyTo}`,
  ], fromName, fromEmail, attachment);

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
  signatureHtml?: string,
  attachment?: PreparedEmailAttachment | null
) {
  const gmail = getGmailClient(accessToken);

  const subject = processTemplate(subjectTemplate, contact, false);
  const body = processTemplate(bodyTemplate, contact, true, signatureHtml ?? "");

  const mimeMessageId = `<${crypto.randomUUID()}@mail.gmail.com>`;
  const rawMessage = createMimeMessage(contact.email, subject, body, mimeMessageId, [], undefined, undefined, attachment);

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
