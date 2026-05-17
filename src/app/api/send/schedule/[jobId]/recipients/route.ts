import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/server";
import { resolveDbUser } from "@/lib/supabase/resolve-user";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ jobId: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { jobId } = await params;
  if (!jobId || jobId.length > 64) {
    return NextResponse.json({ error: "Invalid jobId" }, { status: 400 });
  }

  try {
    const { userId } = await resolveDbUser({ email: session.user.email });
    const db = createAdminClient();

    const { data: job, error: jobError } = await db
      .from("send_jobs")
      .select("id, status, scheduled_at, completed_at")
      .eq("id", jobId)
      .eq("user_id", userId)
      .maybeSingle();
    if (jobError) throw jobError;
    if (!job) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const { data: recipients, error: recipientsError } = await db
      .from("send_recipients")
      .select(
        "email, status, last_error, gmail_message_id, gmail_thread_id, gmail_mime_message_id, sent_at"
      )
      .eq("job_id", jobId);
    if (recipientsError) throw recipientsError;

    return NextResponse.json({
      job: {
        id: job.id,
        status: job.status,
        scheduledAt: job.scheduled_at,
        completedAt: job.completed_at,
      },
      recipients: recipients ?? [],
    });
  } catch (err) {
    console.error("Error loading recipients:", err);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
