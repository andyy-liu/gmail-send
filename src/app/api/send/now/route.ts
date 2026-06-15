import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { sendMessage, sendReply, hasRecipientReplied } from "@/lib/gmail";
import type { Contact } from "@/lib/gmail";
import type { EmailAttachment } from "@/lib/attachments";
import { validateContacts, hasCRLF, validateTemplateTokens, validateEmailAttachment } from "@/lib/validate";
import { requireUserId } from "@/lib/sync/auth-helper";
import { listVariables } from "@/lib/sync/variables-repo";
import { filterStoppedContactsForBatch, recordSendOutcome } from "@/lib/sync/repo";
import { resolveAttachmentForSend } from "@/lib/attachment-storage";

export async function POST(request: Request) {
  try {
    const session = await getServerSession(authOptions);

    if (!session || !session.accessToken) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const {
      batchId,
      subject,
      body: emailBody,
      signature,
      contacts,
      attachment,
      parentThreadIds,
      parentMimeMessageIds,
    }: {
      batchId?: string;
      subject: string;
      body: string;
      signature?: string;
      contacts: Contact[];
      attachment?: unknown;
      parentThreadIds?: Record<string, string>;
      parentMimeMessageIds?: Record<string, string>;
    } = body;

    if (!subject || !emailBody || !contacts || !Array.isArray(contacts)) {
      return NextResponse.json({ error: "Invalid request payload" }, { status: 400 });
    }
    if (hasCRLF(subject)) {
      return NextResponse.json({ error: "Invalid characters in subject" }, { status: 400 });
    }
    const contactError = validateContacts(contacts);
    if (contactError) {
      return NextResponse.json({ error: contactError }, { status: 400 });
    }
    const attachmentError = validateEmailAttachment(attachment);
    if (attachmentError) {
      return NextResponse.json({ error: attachmentError }, { status: 400 });
    }
    const emailAttachment = attachment as EmailAttachment | null | undefined;
    if (emailAttachment && !batchId) {
      return NextResponse.json({ error: "batchId is required for attachments" }, { status: 400 });
    }
    const auth = await requireUserId();
    if ("response" in auth) return auth.response;
    const variables = await listVariables(auth.userId);
    const templateError = validateTemplateTokens(subject, emailBody, variables);
    if (templateError) {
      return NextResponse.json({ error: templateError }, { status: 400 });
    }
    if (parentThreadIds) {
      for (const v of Object.values(parentThreadIds)) {
        if (hasCRLF(v)) return NextResponse.json({ error: "Invalid thread ID" }, { status: 400 });
      }
    }
    if (parentMimeMessageIds) {
      for (const v of Object.values(parentMimeMessageIds)) {
        if (hasCRLF(v)) return NextResponse.json({ error: "Invalid message ID" }, { status: 400 });
      }
    }

    type Result = {
      email: string;
      status: "sent" | "failed" | "skipped_replied" | "manually_stopped";
      messageId?: string;
      threadId?: string;
      mimeMessageId?: string;
      error?: string;
    };
    const {
      eligibleContacts,
      stoppedContacts,
    } = batchId
      ? await filterStoppedContactsForBatch(auth.userId, batchId, contacts)
      : { eligibleContacts: contacts, stoppedContacts: [] };
    const results: Result[] = stoppedContacts.map((contact) => ({
      email: contact.email,
      status: "manually_stopped",
      error: "Sequence manually stopped.",
    }));
    const preparedAttachment = await resolveAttachmentForSend(
      emailAttachment,
      auth.userId,
      batchId ?? ""
    );

    for (const contact of eligibleContacts) {
      const threadId = parentThreadIds?.[contact.email];
      const mimeMessageId = parentMimeMessageIds?.[contact.email];
      const fromName = session.user?.name ?? undefined;
      const fromEmail = session.user?.email ?? undefined;

      // Reply-skip check for follow-ups. Preserve threadId/mimeMessageId on
      // the skipped result so downstream follow-ups can still reply-thread.
      if (threadId && mimeMessageId) {
        const replied = await hasRecipientReplied(session.accessToken, threadId, contact.email);
        if (replied) {
          results.push({
            email: contact.email,
            status: "skipped_replied",
            threadId,
            mimeMessageId,
            error: "Recipient already replied to the thread.",
          });
          continue;
        }
      }

      try {
        const data = threadId && mimeMessageId
          ? await sendReply(
              session.accessToken,
              contact,
              threadId,
              mimeMessageId,
              subject,
              emailBody,
              signature || undefined,
              fromName,
              fromEmail,
              preparedAttachment
            )
          : await sendMessage(
              session.accessToken,
              contact,
              subject,
              emailBody,
              signature || undefined,
              fromName,
              fromEmail,
              preparedAttachment
            );
        results.push({
          email: contact.email,
          status: "sent",
          messageId: data.id ?? "",
          threadId: data.threadId ?? "",
          mimeMessageId: data.mimeMessageId,
        });
      } catch (err: unknown) {
        results.push({
          email: contact.email,
          status: "failed",
          error: err instanceof Error ? err.message : "Unknown error",
        });
      }
    }

    // Persist the outcome server-side. The client can no longer forge sent
    // state via PATCH, so this is the authoritative write. Persistence is
    // best-effort: we still return results to the client even if the DB
    // update fails (the emails already went out — losing the audit record
    // is recoverable, undoing a Gmail send is not).
    if (batchId) {
      try {
        await recordSendOutcome(auth.userId, batchId, results);
      } catch (persistErr) {
        console.error("send/now: failed to persist outcome:", persistErr);
      }
    }

    return NextResponse.json({ results });
  } catch (err: unknown) {
    console.error("Error in send/now:", err);
    const message = err instanceof Error ? err.message : "Internal Server Error";
    const status = message.includes("Attachment") ? 400 : 500;
    return NextResponse.json({ error: status === 400 ? message : "Internal Server Error" }, { status });
  }
}
