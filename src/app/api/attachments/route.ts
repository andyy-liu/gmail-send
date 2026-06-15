import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/sync/auth-helper";
import { deleteSavedAttachmentForUser, listSavedAttachments } from "@/lib/attachment-storage";

export async function GET() {
  try {
    const auth = await requireUserId();
    if ("response" in auth) return auth.response;

    const attachments = await listSavedAttachments(auth.userId);
    return NextResponse.json({ attachments });
  } catch (err) {
    console.error("GET /api/attachments failed:", err);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const auth = await requireUserId();
    if ("response" in auth) return auth.response;

    const body = (await request.json().catch(() => ({}))) as { storagePath?: unknown };
    if (typeof body.storagePath !== "string") {
      return NextResponse.json({ error: "Invalid request payload" }, { status: 400 });
    }

    await deleteSavedAttachmentForUser(auth.userId, body.storagePath);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("DELETE /api/attachments failed:", err);
    const message = err instanceof Error ? err.message : "Internal Server Error";
    const status = message.includes("Attachment") || message.includes("Invalid") ? 400 : 500;
    return NextResponse.json({ error: status === 400 ? message : "Internal Server Error" }, { status });
  }
}
