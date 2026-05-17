import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { sendMessage, sendReply } from "@/lib/gmail";
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

    const results: { email: string; messageId: string; threadId: string; mimeMessageId: string }[] = [];
    const errors: { email: string; error: string }[] = [];

    for (const contact of contacts) {
      try {
        const threadId = parentThreadIds?.[contact.email];
        const mimeMessageId = parentMimeMessageIds?.[contact.email];
        let data;
        const fromName = session.user?.name ?? undefined;
        const fromEmail = session.user?.email ?? undefined;
        if (threadId && mimeMessageId) {
          data = await sendReply(
            session.accessToken,
            contact,
            threadId,
            mimeMessageId,
            subject,
            emailBody,
            signature || undefined,
            fromName,
            fromEmail
          );
        } else {
          data = await sendMessage(
            session.accessToken,
            contact,
            subject,
            emailBody,
            signature || undefined,
            fromName,
            fromEmail
          );
        }
        results.push({
          email: contact.email,
          messageId: data.id ?? "",
          threadId: data.threadId ?? "",
          mimeMessageId: data.mimeMessageId,
        });
      } catch (err: unknown) {
        errors.push({
          email: contact.email,
          error: err instanceof Error ? err.message : "Unknown error",
        });
      }
    }

    return NextResponse.json({ results, errors });
  } catch (err: unknown) {
    console.error("Error in send/now:", err);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
