import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/sync/auth-helper";
import {
  setVariableEnabled,
  renameVariable,
  deleteVariable,
  VariableValidationError,
} from "@/lib/sync/variables-repo";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireUserId();
    if ("response" in auth) return auth.response;
    const { id } = await params;
    const body = (await request.json().catch(() => ({}))) as {
      name?: unknown;
      enabled?: unknown;
    };

    if (typeof body.name === "string") {
      const result = await renameVariable(auth.userId, id, body.name.trim());
      return NextResponse.json(result);
    }
    if (typeof body.enabled === "boolean") {
      const variable = await setVariableEnabled(auth.userId, id, body.enabled);
      return NextResponse.json({ variable });
    }
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  } catch (err) {
    if (err instanceof VariableValidationError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    console.error("PATCH /api/variables/[id] failed:", err);
    const message = err instanceof Error ? err.message : "Internal Server Error";
    const status = message === "Variable not found" ? 404 : 500;
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
    await deleteVariable(auth.userId, id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("DELETE /api/variables/[id] failed:", err);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
