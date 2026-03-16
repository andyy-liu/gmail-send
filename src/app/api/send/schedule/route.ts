import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { addJob, listJobs, removeJob, removeAllJobs } from "@/lib/scheduler";
import type { Contact } from "@/lib/gmail";
import { randomUUID } from "crypto";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json({ jobs: listJobs() });
}

export async function DELETE(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await request.json();
  if (!id) {
    const count = removeAllJobs();
    return NextResponse.json({ ok: true, count });
  }
  const removed = removeJob(id as string);
  if (!removed) return NextResponse.json({ error: "Job not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}

export async function POST(request: Request) {
  try {
    const session = await getServerSession(authOptions);

    if (!session || !session.accessToken || !session.refreshToken) {
      return NextResponse.json({ error: "Unauthorized or missing tokens" }, { status: 401 });
    }

    const body = await request.json();
    const { subject, body: emailBody, signature, contacts, scheduledAt } = body;

    if (!subject || !emailBody || !contacts || !Array.isArray(contacts) || !scheduledAt) {
      return NextResponse.json({ error: "Invalid request payload" }, { status: 400 });
    }

    const scheduledDate = new Date(scheduledAt);
    if (isNaN(scheduledDate.getTime()) || scheduledDate <= new Date()) {
      return NextResponse.json({ error: "scheduledAt must be a valid future date" }, { status: 400 });
    }

    const jobId = randomUUID();

    addJob({
      id: jobId,
      scheduledAt: scheduledDate.toISOString(),
      subject,
      body: emailBody,
      signature: signature || "",
      contacts: contacts as Contact[],
      refreshToken: session.refreshToken,
    });

    return NextResponse.json({ jobId, scheduledAt: scheduledDate.toISOString(), count: (contacts as Contact[]).length });
  } catch (err: unknown) {
    console.error("Error scheduling send:", err);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
