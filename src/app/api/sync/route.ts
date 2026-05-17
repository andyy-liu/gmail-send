import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/sync/auth-helper";
import { loadUserState } from "@/lib/sync/repo";

export async function GET() {
  try {
    const auth = await requireUserId();
    if ("response" in auth) return auth.response;
    const state = await loadUserState(auth.userId);
    return NextResponse.json(state);
  } catch (err) {
    console.error("GET /api/sync failed:", err);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
