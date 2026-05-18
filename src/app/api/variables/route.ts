import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/sync/auth-helper";
import {
  listVariables,
  createVariable,
  VariableValidationError,
} from "@/lib/sync/variables-repo";

export async function GET() {
  try {
    const auth = await requireUserId();
    if ("response" in auth) return auth.response;
    const variables = await listVariables(auth.userId);
    return NextResponse.json({ variables });
  } catch (err) {
    console.error("GET /api/variables failed:", err);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const auth = await requireUserId();
    if ("response" in auth) return auth.response;
    const body = (await request.json().catch(() => ({}))) as { name?: unknown };
    if (typeof body.name !== "string") {
      return NextResponse.json({ error: "name is required" }, { status: 400 });
    }
    const variable = await createVariable(auth.userId, body.name.trim());
    return NextResponse.json({ variable });
  } catch (err) {
    if (err instanceof VariableValidationError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    console.error("POST /api/variables failed:", err);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
