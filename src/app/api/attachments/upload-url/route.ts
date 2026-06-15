import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/sync/auth-helper";
import { createSignedAttachmentUpload } from "@/lib/attachment-storage";

export async function POST(request: Request) {
  try {
    const auth = await requireUserId();
    if ("response" in auth) return auth.response;

    const body = (await request.json().catch(() => ({}))) as {
      name?: unknown;
      contentType?: unknown;
      size?: unknown;
    };
    if (
      typeof body.name !== "string" ||
      typeof body.contentType !== "string" ||
      typeof body.size !== "number"
    ) {
      return NextResponse.json({ error: "Invalid request payload" }, { status: 400 });
    }

    const upload = await createSignedAttachmentUpload({
      userId: auth.userId,
      name: body.name,
      contentType: body.contentType,
      size: body.size,
    });

    return NextResponse.json(upload);
  } catch (err) {
    console.error("POST /api/attachments/upload-url failed:", err);
    const message = err instanceof Error ? err.message : "Internal Server Error";
    const status =
      message === "Batch not found"
        ? 404
        : message.includes("Attachment") || message.includes("Invalid")
          ? 400
          : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
