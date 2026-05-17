import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

function getKey(): Buffer {
  const keyBase64 = process.env.GOOGLE_TOKEN_ENCRYPTION_KEY;
  if (!keyBase64) throw new Error("Missing GOOGLE_TOKEN_ENCRYPTION_KEY");
  const key = Buffer.from(keyBase64, "base64");
  if (key.length !== 32) {
    throw new Error(
      `GOOGLE_TOKEN_ENCRYPTION_KEY must decode to exactly 32 bytes (got ${key.length}). Generate with: openssl rand -base64 32`
    );
  }
  return key;
}

export function encryptToken(plaintext: string): { ciphertext: string; iv: string; tag: string } {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", getKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return {
    ciphertext: encrypted.toString("base64"),
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
  };
}

export function decryptToken(ciphertext: string, iv: string, tag: string): string {
  const decipher = createDecipheriv("aes-256-gcm", getKey(), Buffer.from(iv, "base64"));
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertext, "base64")),
    decipher.final(),
  ]).toString("utf8");
}
