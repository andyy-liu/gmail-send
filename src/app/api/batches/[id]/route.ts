import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/sync/auth-helper";
import { updateBatch, deleteBatch, type BatchPatch } from "@/lib/sync/repo";

/**
 * User-facing PATCH allowlist. Notably absent: status, sentAt,
 * recipientResults, scheduledAt, scheduledJobId. Those are owned by the
 * server endpoints that actually do the work (send/now persists status+sentAt
 * via recordSendOutcome; drafts/create persists status via recordDraftsCreated;
 * scheduler.scheduleJob/cancelJob own scheduledAt and scheduledJobId). If the
 * client could write them here, it could forge sent state without proving the
 * Gmail send happened.
 */
function parsePatch(input: unknown): BatchPatch | { error: string } {
  if (!input || typeof input !== "object") return { error: "Invalid body" };
  const raw = input as Record<string, unknown>;
  const patch: BatchPatch = {};

  if ("name" in raw) {
    if (typeof raw.name !== "string" || raw.name.length > 200) return { error: "Invalid name" };
    patch.name = raw.name;
  }
  if ("subject" in raw) {
    if (typeof raw.subject !== "string") return { error: "Invalid subject" };
    patch.subject = raw.subject;
  }
  if ("body" in raw) {
    if (typeof raw.body !== "string") return { error: "Invalid body field" };
    patch.body = raw.body;
  }
  if ("scheduledDelay" in raw) {
    if (raw.scheduledDelay === null || raw.scheduledDelay === undefined) {
      patch.scheduledDelay = null;
    } else {
      const d = raw.scheduledDelay as { value?: unknown; unit?: unknown };
      if (
        typeof d.value !== "number" ||
        !Number.isFinite(d.value) ||
        d.value <= 0 ||
        (d.unit !== "days" && d.unit !== "hours")
      ) {
        return { error: "Invalid scheduledDelay" };
      }
      patch.scheduledDelay = { value: d.value, unit: d.unit };
    }
  }

  return patch;
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireUserId();
    if ("response" in auth) return auth.response;
    const { id } = await params;

    const raw = await request.json().catch(() => null);
    const parsed = parsePatch(raw);
    if ("error" in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });

    await updateBatch(auth.userId, id, parsed);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("PATCH /api/batches/[id] failed:", err);
    const message = err instanceof Error ? err.message : "Internal Server Error";
    const status = message === "Batch not found" ? 404 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireUserId();
    if ("response" in auth) return auth.response;
    const { id } = await params;

    await deleteBatch(auth.userId, id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("DELETE /api/batches/[id] failed:", err);
    const message = err instanceof Error ? err.message : "Internal Server Error";
    const status = message === "Batch not found" ? 404 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
