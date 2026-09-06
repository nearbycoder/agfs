import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

function key(secret: string) {
  return createHash("sha256").update(`agfs-device-token:${secret}`).digest();
}

export function sealDeviceToken(token: string, secret: string): string {
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(secret), nonce);
  const encrypted = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  return `v1.${Buffer.concat([nonce, cipher.getAuthTag(), encrypted]).toString("base64url")}`;
}

export function openDeviceToken(value: string, secret: string): string {
  // Existing pending logins live for at most ten minutes across deployment.
  if (value.startsWith("agfs_")) return value;
  if (!value.startsWith("v1.")) throw new Error("Invalid device token");
  const bytes = Buffer.from(value.slice(3), "base64url");
  const cipher = createDecipheriv("aes-256-gcm", key(secret), bytes.subarray(0, 12));
  cipher.setAuthTag(bytes.subarray(12, 28));
  return Buffer.concat([cipher.update(bytes.subarray(28)), cipher.final()]).toString("utf8");
}
