import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { resolveDbUser } from "@/lib/supabase/resolve-user";

/**
 * Resolve the current user's app_users.id from the session. Returns either
 * `{ userId }` or a `NextResponse` to return immediately (401).
 */
export async function requireUserId(): Promise<
  { userId: string } | { response: NextResponse }
> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return { response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  const { userId } = await resolveDbUser({ email: session.user.email });
  return { userId };
}
