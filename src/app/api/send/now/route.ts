import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { sendMessage, sendReply, hasRecipientReplied } from "@/lib/gmail";
import type { Contact } from "@/lib/gmail";
import { validateContacts, hasCRLF } from "@/lib/validate";

export async function POST(request: Request) {
  try {
    const session = await getServerSession(authOptions);

    if (!session || !session.accessToken) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const {
      subject,
      body: emailBody,
      signature,
      contacts,
      parentThreadIds,
      parentMimeMessageIds,
    }: {
      subject: string;
      body: string;
      signature?: string;
      contacts: Contact[];
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
      status: "sent" | "failed" | "skipped_replied";
      messageId?: string;
      threadId?: string;
      mimeMessageId?: string;
      error?: string;
    };
    const results: Result[] = [];

    for (const contact of contacts) {
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
              fromEmail
            )
          : await sendMessage(
              session.accessToken,
              contact,
              subject,
              emailBody,
              signature || undefined,
              fromName,
              fromEmail
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

    return NextResponse.json({ results });
  } catch (err: unknown) {
    console.error("Error in send/now:", err);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
