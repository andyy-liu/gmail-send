import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/sync/auth-helper";
import { setSignature } from "@/lib/sync/repo";

const MAX_SIGNATURE_LEN = 50_000;

export async function PUT(request: Request) {
  try {
    const auth = await requireUserId();
    if ("response" in auth) return auth.response;

    const body = (await request.json().catch(() => ({}))) as { signature?: unknown };
    if (typeof body.signature !== "string" || body.signature.length > MAX_SIGNATURE_LEN) {
      return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
    }

    await setSignature(auth.userId, body.signature);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("PUT /api/signature failed:", err);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
