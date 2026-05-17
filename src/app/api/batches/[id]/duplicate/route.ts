import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/sync/auth-helper";
import { duplicateCampaign } from "@/lib/sync/repo";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireUserId();
    if ("response" in auth) return auth.response;
    const { id } = await params;

    const batches = await duplicateCampaign(auth.userId, id);
    return NextResponse.json({ batches });
  } catch (err) {
    console.error("POST /api/batches/[id]/duplicate failed:", err);
    const message = err instanceof Error ? err.message : "Internal Server Error";
    const status =
      message === "Campaign not found" || message === "Batch is not a campaign" ? 404 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
