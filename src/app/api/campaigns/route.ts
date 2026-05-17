import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/sync/auth-helper";
import { createCampaign } from "@/lib/sync/repo";

export async function POST(request: Request) {
  try {
    const auth = await requireUserId();
    if ("response" in auth) return auth.response;

    const body = (await request.json().catch(() => ({}))) as { name?: unknown };
    if (typeof body.name !== "string" || !body.name.trim() || body.name.length > 200) {
      return NextResponse.json({ error: "Invalid name" }, { status: 400 });
    }

    const batch = await createCampaign(auth.userId, body.name.trim());
    return NextResponse.json({ batch });
  } catch (err) {
    console.error("POST /api/campaigns failed:", err);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
