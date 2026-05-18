import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/sync/auth-helper";
import { replaceContacts } from "@/lib/sync/repo";
import type { ContactRow } from "@/lib/batches";
import { hasCRLF, isValidEmail } from "@/lib/validate";

const MAX_CONTACTS = 5000;
const MAX_FIELD_LEN = 500;

function parseCustomFields(
  input: unknown,
  rowLabel: string,
): Record<string, string> | { error: string } {
  if (input == null) return {};
  if (typeof input !== "object" || Array.isArray(input)) {
    return { error: `${rowLabel}: customFields must be an object` };
  }
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (typeof key !== "string" || !key) return { error: `${rowLabel}: invalid custom field key` };
    if (typeof value !== "string") return { error: `${rowLabel}: custom field "${key}" must be a string` };
    if (value.length > MAX_FIELD_LEN) return { error: `${rowLabel}: custom field "${key}" too long` };
    if (hasCRLF(value)) return { error: `${rowLabel}: custom field "${key}" contains invalid characters` };
    out[key] = value;
  }
  return out;
}

/**
 * Save-time contact parser. Permissive about empty rows (the UI saves
 * mid-edit) but rejects content with newlines or malformed emails. Any field
 * that has content must be valid; empty fields are passed through.
 */
function parseContacts(input: unknown): ContactRow[] | { error: string } {
  if (!Array.isArray(input)) return { error: "contacts must be an array" };
  if (input.length > MAX_CONTACTS) return { error: `too many contacts (max ${MAX_CONTACTS})` };
  const out: ContactRow[] = [];
  for (let i = 0; i < input.length; i++) {
    const item = input[i];
    const label = `Row ${i + 1}`;
    if (!item || typeof item !== "object") return { error: `${label}: invalid entry` };
    const c = item as Record<string, unknown>;
    if (typeof c.id !== "string" || typeof c.email !== "string" || typeof c.firstName !== "string" || typeof c.company !== "string") {
      return { error: `${label}: invalid entry` };
    }
    if (c.email.length > MAX_FIELD_LEN || c.firstName.length > MAX_FIELD_LEN || c.company.length > MAX_FIELD_LEN) {
      return { error: `${label}: field too long` };
    }
    if (hasCRLF(c.email) || hasCRLF(c.firstName) || hasCRLF(c.company)) {
      return { error: `${label}: field contains invalid characters` };
    }
    if (c.email.trim() && !isValidEmail(c.email)) {
      return { error: `${label}: invalid email address` };
    }
    const customFields = parseCustomFields(c.customFields, label);
    if ("error" in customFields) return { error: customFields.error };
    out.push({ id: c.id, email: c.email, firstName: c.firstName, company: c.company, customFields });
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
