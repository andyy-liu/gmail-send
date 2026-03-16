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

function createMimeMessage(to: string, subject: string, htmlBody: string): string {
  const wrappedHtml = [
    `<!DOCTYPE html>`,
    `<html>`,
    `<head><meta charset="UTF-8"></head>`,
    `<body>`,
    cleanListHtml(htmlBody),
    `</body></html>`,
  ].join("\n");

  const message = [
    `To: ${to}`,
    `Subject: =?UTF-8?B?${Buffer.from(subject).toString("base64")}?=`,
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
  signatureHtml?: string
) {
  const auth = new google.auth.OAuth2();
  auth.setCredentials({ access_token: accessToken });

  const gmail = google.gmail({ version: "v1", auth });

  const subject = processTemplate(subjectTemplate, contact, false);
  const body = processTemplate(bodyTemplate, contact, true, signatureHtml ?? "");

  const rawMessage = createMimeMessage(contact.email, subject, body);

  const res = await gmail.users.messages.send({
    userId: "me",
    requestBody: {
      raw: rawMessage,
    },
  });

  return res.data;
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

  const rawMessage = createMimeMessage(contact.email, subject, body);

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
