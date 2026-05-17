import { createAdminClient } from "./server";
import { encryptToken } from "../encrypt";

export async function resolveDbUser(params: {
  email: string;
  name?: string | null;
  image?: string | null;
  googleSub?: string | null;
  refreshToken?: string | null;
  scopes?: string | null;
}): Promise<{ userId: string; googleAccountId: string | null }> {
  const db = createAdminClient();

  // Omit google_sub from the payload when not provided so the on-conflict UPDATE
  // does not overwrite the existing stable identity with NULL. Matches the
  // coalesce(...) pattern in docs/SUPABASE_SETUP.md.
  const userPayload: Record<string, unknown> = {
    email: params.email,
    name: params.name ?? null,
    image_url: params.image ?? null,
  };
  if (params.googleSub) userPayload.google_sub = params.googleSub;

  const { data: appUser, error: userError } = await db
    .from("app_users")
    .upsert(userPayload, { onConflict: "email" })
    .select()
    .single();
  if (userError || !appUser) throw userError ?? new Error("Failed to upsert app_user");

  if (!params.refreshToken) {
    const { data: ga } = await db
      .from("google_accounts")
      .select("id")
      .eq("user_id", appUser.id)
      .eq("email", params.email)
      .maybeSingle();
    return { userId: appUser.id, googleAccountId: ga?.id ?? null };
  }

  const encrypted = encryptToken(params.refreshToken);
  const keyVersion = parseInt(process.env.GOOGLE_TOKEN_ENCRYPTION_KEY_VERSION ?? "1");

  const gaPayload: Record<string, unknown> = {
    user_id: appUser.id,
    email: params.email,
    refresh_token_ciphertext: encrypted.ciphertext,
    refresh_token_iv: encrypted.iv,
    refresh_token_tag: encrypted.tag,
    refresh_token_key_version: keyVersion,
    scopes: (params.scopes ?? "").split(" ").filter(Boolean),
  };
  if (params.googleSub) gaPayload.google_sub = params.googleSub;

  const { data: ga, error: gaError } = await db
    .from("google_accounts")
    .upsert(gaPayload, { onConflict: "user_id,email" })
    .select()
    .single();
  if (gaError || !ga) throw gaError ?? new Error("Failed to upsert google_account");

  return { userId: appUser.id, googleAccountId: ga.id };
}
