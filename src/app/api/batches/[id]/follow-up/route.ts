import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/sync/auth-helper";
import { createFollowUp } from "@/lib/sync/repo";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireUserId();
    if ("response" in auth) return auth.response;
    const { id } = await params;

    const batch = await createFollowUp(auth.userId, id);
    return NextResponse.json({ batch });
  } catch (err) {
    console.error("POST /api/batches/[id]/follow-up failed:", err);
    const message = err instanceof Error ? err.message : "Internal Server Error";
    const status = message === "Parent batch not found" ? 404 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
