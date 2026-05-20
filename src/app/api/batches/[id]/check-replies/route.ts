import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { requireUserId } from "@/lib/sync/auth-helper";
import { createAdminClient } from "@/lib/supabase/server";
import { hasRecipientReplied } from "@/lib/gmail";
import { markRecipientsReplied } from "@/lib/sync/repo";
import type { RecipientResult } from "@/lib/batches";

/**
 * Proactively check Gmail for replies on this batch's sent threads. Recipients
 * who replied get flipped from `sent` to `replied` in recipient_results so the
 * recipients tab can surface "sequence stopped" before the next follow-up runs.
 *
 * The scheduler still does its own just-in-time reply check at follow-up send
 * time — this endpoint is purely for UI visibility ahead of that.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.accessToken) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const auth = await requireUserId();
    if ("response" in auth) return auth.response;

    const { id } = await params;

    const db = createAdminClient();
    const { data: batch, error } = await db
      .from("batches")
      .select("recipient_results, status")
      .eq("id", id)
      .eq("user_id", auth.userId)
      .single();
    if (error || !batch) {
      return NextResponse.json({ error: "Batch not found" }, { status: 404 });
    }

    const results = Array.isArray(batch.recipient_results)
      ? (batch.recipient_results as RecipientResult[])
      : [];

    // Only check recipients we actually delivered to and have a thread for.
    const candidates = results.filter(
      (r) => r.status === "sent" && r.threadId && r.email
    );
    if (candidates.length === 0) {
      return NextResponse.json({ results, replied: [] });
    }

    const repliedEmails: string[] = [];
    for (const r of candidates) {
      try {
        const did = await hasRecipientReplied(session.accessToken, r.threadId!, r.email);
        if (did) repliedEmails.push(r.email);
      } catch (err) {
        console.error(`[check-replies] ${r.email}:`, err);
      }
    }

    const updated =
      repliedEmails.length > 0
        ? await markRecipientsReplied(auth.userId, id, repliedEmails)
        : results;

    return NextResponse.json({ results: updated, replied: repliedEmails });
  } catch (err) {
    console.error("POST /api/batches/[id]/check-replies failed:", err);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
