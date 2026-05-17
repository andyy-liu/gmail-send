import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { scheduleJob, listJobsForUser, cancelJob, cancelAllJobsForUser } from "@/lib/scheduler";
import { resolveDbUser } from "@/lib/supabase/resolve-user";
import type { Contact } from "@/lib/gmail";
import { validateContacts, hasCRLF } from "@/lib/validate";

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
    const { id } = body as { id?: string };

    if (!id) {
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
      subject,
      body: emailBody,
      signature,
      contacts,
      scheduledAt,
      parentThreadIds,
      parentMimeMessageIds,
    } = body as {
      subject: string;
      body: string;
      signature?: string;
      contacts: Contact[];
      scheduledAt: string;
      parentThreadIds?: Record<string, string>;
      parentMimeMessageIds?: Record<string, string>;
    };

    if (!subject || !emailBody || !contacts || !Array.isArray(contacts) || !scheduledAt) {
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
      subject,
      body: emailBody,
      signature: signature || "",
      contacts,
      scheduledAt: scheduledDate.toISOString(),
      parentThreads,
    });

    return NextResponse.json({ jobId, scheduledAt: scheduledDate.toISOString(), count: contacts.length });
  } catch (err: unknown) {
    console.error("Error scheduling send:", err);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
