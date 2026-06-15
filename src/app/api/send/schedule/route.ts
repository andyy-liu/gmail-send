import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { scheduleJob, listJobsForUser, cancelJob, cancelAllJobsForUser } from "@/lib/scheduler";
import { resolveDbUser } from "@/lib/supabase/resolve-user";
import type { Contact } from "@/lib/gmail";
import type { EmailAttachment } from "@/lib/attachments";
import { validateContacts, hasCRLF, validateTemplateTokens, validateEmailAttachment } from "@/lib/validate";
import { listVariables } from "@/lib/sync/variables-repo";
import { filterStoppedContactsForBatch } from "@/lib/sync/repo";
import { resolveAttachmentForSend } from "@/lib/attachment-storage";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const { userId } = await resolveDbUser({ email: session.user.email });
    const jobs = await listJobsForUser(userId);
    return NextResponse.json({ jobs });
  } catch (err) {
    console.error("Error listing jobs:", err);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const { userId } = await resolveDbUser({ email: session.user.email });
    const body = await request.json().catch(() => ({}));
    const { id, cancelAll } = body as { id?: string; cancelAll?: boolean };

    if (!id) {
      // Cancel-all is a destructive operation and used to be the default when
      // no id was sent. Require an explicit opt-in so a missing/empty id from
      // a buggy client cannot wipe every pending job.
      if (cancelAll !== true) {
        return NextResponse.json({ error: "id is required" }, { status: 400 });
      }
      const count = await cancelAllJobsForUser(userId);
      return NextResponse.json({ ok: true, count });
    }

    const cancelled = await cancelJob(id, userId);
    if (!cancelled) return NextResponse.json({ error: "Job not found or not cancellable" }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Error cancelling job:", err);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email || !session.accessToken || !session.refreshToken) {
      return NextResponse.json({ error: "Unauthorized or missing tokens" }, { status: 401 });
    }

    const body = await request.json();
    const {
      batchId,
      subject,
      body: emailBody,
      signature,
      contacts,
      scheduledAt,
      attachment,
      parentThreadIds,
      parentMimeMessageIds,
    } = body as {
      batchId: string;
      subject: string;
      body: string;
      signature?: string;
      contacts: Contact[];
      scheduledAt: string;
      attachment?: unknown;
      parentThreadIds?: Record<string, string>;
      parentMimeMessageIds?: Record<string, string>;
    };

    if (!batchId || !subject || !emailBody || !contacts || !Array.isArray(contacts) || !scheduledAt) {
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

    const scheduledDate = new Date(scheduledAt);
    if (isNaN(scheduledDate.getTime()) || scheduledDate <= new Date()) {
      return NextResponse.json({ error: "scheduledAt must be a valid future date" }, { status: 400 });
    }

    const { userId, googleAccountId } = await resolveDbUser({
      email: session.user.email,
      name: session.user.name,
      image: session.user.image,
      refreshToken: session.refreshToken,
    });

    if (!googleAccountId) {
      return NextResponse.json({ error: "No Google account found for user" }, { status: 400 });
    }

    const variables = await listVariables(userId);
    const templateError = validateTemplateTokens(subject, emailBody, variables);
    if (templateError) {
      return NextResponse.json({ error: templateError }, { status: 400 });
    }
    const { eligibleContacts } = await filterStoppedContactsForBatch(userId, batchId, contacts);
    if (eligibleContacts.length === 0) {
      return NextResponse.json(
        { error: "All recipients are stopped for this sequence." },
        { status: 400 }
      );
    }
    await resolveAttachmentForSend(emailAttachment, userId, batchId);

    let parentThreads: Record<string, { threadId: string; mimeMessageId: string }> | undefined;
    if (parentThreadIds && parentMimeMessageIds) {
      parentThreads = {};
      for (const email of Object.keys(parentThreadIds)) {
        const threadId = parentThreadIds[email];
        const mimeMessageId = parentMimeMessageIds[email];
        if (threadId && mimeMessageId) {
          parentThreads[email] = { threadId, mimeMessageId };
        }
      }
    }

    const jobId = await scheduleJob({
      userId,
      googleAccountId,
      batchId,
      subject,
      body: emailBody,
      signature: signature || "",
      contacts: eligibleContacts,
      attachment: emailAttachment ?? null,
      scheduledAt: scheduledDate.toISOString(),
      parentThreads,
    });

    return NextResponse.json({ jobId, scheduledAt: scheduledDate.toISOString(), count: eligibleContacts.length });
  } catch (err: unknown) {
    console.error("Error scheduling send:", err);
    const message = err instanceof Error ? err.message : "Internal Server Error";
    const status =
      message === "Batch not found" || message === "Previous email not found"
        ? 404
        : message.includes("Schedule") ||
          message.includes("scheduled") ||
          message.includes("Follow-up") ||
          message.includes("before") ||
          message.includes("Attachment")
        ? 400
        : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
