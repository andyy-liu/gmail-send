import { NextAuthOptions } from "next-auth";
import GoogleProvider from "next-auth/providers/google";

async function refreshAccessToken(refreshToken: string) {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? "Token refresh failed");
  return {
    accessToken: data.access_token as string,
    expiresAt: Math.floor(Date.now() / 1000) + (data.expires_in as number),
  };
}

export const authOptions: NextAuthOptions = {
  session: {
    strategy: "jwt",
    // Keep users signed in as long as possible on this device.
    maxAge: 60 * 60 * 24 * 30, // 30 days
    updateAge: 60 * 60 * 24, // refresh session age every 24h
  },
  jwt: {
    maxAge: 60 * 60 * 24 * 30, // 30 days
  },
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID as string,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET as string,
      authorization: {
        params: {
          scope: "openid email profile https://www.googleapis.com/auth/gmail.compose https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/gmail.metadata",
          prompt: "consent",
          access_type: "offline",
          response_type: "code",
        },
      },
    }),
  ],
  callbacks: {
    async jwt({ token, account }) {
      if (account) {
        token.accessToken = account.access_token;
        // Google may only return refresh_token on first consent.
        token.refreshToken = account.refresh_token ?? token.refreshToken;
        token.expiresAt = account.expires_at; // seconds since epoch
      }
      // Token still valid (with 60s buffer)
      if (Date.now() < (token.expiresAt as number) * 1000 - 60_000) {
        return token;
      }
      if (!token.refreshToken) {
        console.error("No refresh token available to renew access token.");
        return { ...token, error: "RefreshAccessTokenError" };
      }
      // Token expired — refresh it
      try {
        const refreshed = await refreshAccessToken(token.refreshToken as string);
        return { ...token, ...refreshed };
      } catch (err) {
        console.error("Failed to refresh access token:", err);
        return { ...token, error: "RefreshAccessTokenError" };
      }
    },
    async session({ session, token }) {
      session.accessToken = token.accessToken as string;
      session.refreshToken = token.refreshToken as string;
      return session;
    },
  },
  secret: process.env.NEXTAUTH_SECRET,
};
