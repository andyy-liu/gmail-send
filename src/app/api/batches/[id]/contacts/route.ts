import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/sync/auth-helper";
import { replaceContacts } from "@/lib/sync/repo";
import type { ContactRow } from "@/lib/batches";

const MAX_CONTACTS = 5000;
const MAX_FIELD_LEN = 500;

function parseContacts(input: unknown): ContactRow[] | { error: string } {
  if (!Array.isArray(input)) return { error: "contacts must be an array" };
  if (input.length > MAX_CONTACTS) return { error: `too many contacts (max ${MAX_CONTACTS})` };
  const out: ContactRow[] = [];
  for (const item of input) {
    if (!item || typeof item !== "object") return { error: "Invalid contact entry" };
    const c = item as Record<string, unknown>;
    if (typeof c.id !== "string" || typeof c.email !== "string" || typeof c.firstName !== "string" || typeof c.company !== "string") {
      return { error: "Invalid contact entry" };
    }
    if (c.email.length > MAX_FIELD_LEN || c.firstName.length > MAX_FIELD_LEN || c.company.length > MAX_FIELD_LEN) {
      return { error: "Contact field too long" };
    }
    out.push({ id: c.id, email: c.email, firstName: c.firstName, company: c.company });
  }
  return out;
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireUserId();
    if ("response" in auth) return auth.response;
    const { id } = await params;

    const raw = await request.json().catch(() => null);
    const body = raw as { contacts?: unknown } | null;
    if (!body) return NextResponse.json({ error: "Invalid body" }, { status: 400 });

    const parsed = parseContacts(body.contacts);
    if ("error" in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });

    await replaceContacts(auth.userId, id, parsed);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("PUT /api/batches/[id]/contacts failed:", err);
    const message = err instanceof Error ? err.message : "Internal Server Error";
    const status = message === "Batch not found" ? 404 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
