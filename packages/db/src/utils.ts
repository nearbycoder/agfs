import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export const AGFS_TOKEN_PREFIX = "agfs";
export const AGFS_SHARE_PREFIX = "agfssh";
export const AGFS_UPLOAD_PREFIX = "agfsupl";

export function now(): Date {
  return new Date();
}

export function createAgfsId(prefix: string): string {
  return `${prefix}_${randomBytes(12).toString("hex")}`;
}

export function normalizeAgfsPath(input: string): string {
  if (!input) {
    throw new Error("Path is required");
  }

  const normalized = `/${input}`.replace(/\/+/g, "/");
  const pieces = normalized
    .split("/")
    .filter(Boolean)
    .map((piece) => piece.trim())
    .filter(Boolean);

  if (pieces.some((piece) => piece === "." || piece === "..")) {
    throw new Error("Relative path segments are not allowed");
  }
  if (pieces.some((piece) => /[\\\u0000-\u001F\u007F]/.test(piece))) {
    throw new Error("Path contains unsupported characters");
  }

  const result = `/${pieces.join("/")}`;
  return result === "//" ? "/" : result;
}

export function getParentPath(path: string): string | null {
  const normalized = normalizeAgfsPath(path);
  if (normalized === "/") {
    return null;
  }

  const lastSlash = normalized.lastIndexOf("/");
  return lastSlash <= 0 ? "/" : normalized.slice(0, lastSlash);
}

export function getBaseName(path: string): string {
  const normalized = normalizeAgfsPath(path);
  if (normalized === "/") {
    return "/";
  }

  return normalized.split("/").filter(Boolean).at(-1) ?? "/";
}

export function hashSecret(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}

export function secretPrefix(secret: string): string {
  return secret.slice(0, 12);
}

export function createApiTokenValue(): string {
  return `${AGFS_TOKEN_PREFIX}_${randomBytes(24).toString("base64url")}`;
}

export function createShareTokenValue(): string {
  return `${AGFS_SHARE_PREFIX}_${randomBytes(24).toString("base64url")}`;
}

export function createUploadTokenValue(): string {
  return `${AGFS_UPLOAD_PREFIX}_${randomBytes(24).toString("base64url")}`;
}

export function createDeviceCode(): string {
  return randomBytes(24).toString("base64url");
}

export function createUserCode(): string {
  return randomBytes(4).toString("hex").toUpperCase();
}

export function parseTtl(input: string, { maxDays = 7 }: { maxDays?: number } = {}): number {
  const match = /^(\d+)\s*(m|h|d)$/i.exec(input.trim());
  if (!match) {
    throw new Error("Invalid TTL");
  }

  const value = Number(match[1]);
  const unit = match[2].toLowerCase();
  const ms = unit === "m" ? value * 60_000 : unit === "h" ? value * 3_600_000 : value * 86_400_000;

  if (ms > maxDays * 86_400_000) {
    throw new Error(`TTL cannot exceed ${maxDays} days`);
  }

  return ms;
}

export function toIsoString(value: number | Date | null | undefined): string | null {
  if (value == null) {
    return null;
  }

  return new Date(value).toISOString();
}

export function buildObjectKey(ownerId: string, entryId: string, versionId: string): string {
  return `u/${ownerId}/f/${entryId}/${versionId}`;
}

export function verifyHash(secret: string, expectedHash: string): boolean {
  const actual = Buffer.from(hashSecret(secret), "utf8");
  const expected = Buffer.from(expectedHash, "utf8");

  if (actual.length !== expected.length) {
    return false;
  }

  return timingSafeEqual(actual, expected);
}
