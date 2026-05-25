import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/sync/auth-helper";
import { stopRecipientSequence } from "@/lib/sync/repo";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireUserId();
    if ("response" in auth) return auth.response;
    const { id } = await params;
    const body = (await request.json().catch(() => null)) as { email?: unknown } | null;
    const email = typeof body?.email === "string" ? body.email : "";

    const results = await stopRecipientSequence(auth.userId, id, email);
    return NextResponse.json({ results });
  } catch (err) {
    console.error("POST /api/batches/[id]/recipients/stop failed:", err);
    const message = err instanceof Error ? err.message : "Internal Server Error";
    const status =
      message === "Batch not found" ? 404 :
      message === "Email is required" ? 400 :
      500;
    return NextResponse.json({ error: message }, { status });
  }
}
