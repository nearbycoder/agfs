import { and, eq, gt, isNull, or } from "drizzle-orm";
import {
  apiTokens,
  createApiTokenValue,
  createAgfsId,
  createDeviceCode,
  createUserCode,
  deviceCodes,
  hashSecret,
  now,
  parseTtl,
  secretPrefix,
  users,
  verifyHash,
} from "@agfs/db";
import type { ApiTokenRecord, SessionUser } from "@agfs/contracts";
import { auth } from "./auth";
import { requireStringBindings } from "./bindings";
import { db } from "./db";
import { getBearerToken } from "./http";

export interface RequestAuth {
  authSource: "session" | "api-token";
  tokenId?: string;
  user: SessionUser;
}

function mapUser(row: { id: string; name: string | null; email: string; image?: string | null }): SessionUser {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    image: row.image ?? null,
  };
}

export async function resolveRequestAuth(request: Request): Promise<RequestAuth | null> {
  const session = await auth.api.getSession({
    headers: request.headers,
  });

  if (session?.user) {
    return {
      authSource: "session",
      user: mapUser(session.user),
    };
  }

  const bearer = getBearerToken(request);
  if (!bearer) {
    return null;
  }

  const tokenHash = hashSecret(bearer);
  const nowAt = now();
  const [record] = await db
    .select({
      id: apiTokens.id,
      ownerId: apiTokens.ownerId,
      label: apiTokens.label,
      prefix: apiTokens.prefix,
      tokenHash: apiTokens.tokenHash,
      userId: users.id,
      userName: users.name,
      userEmail: users.email,
      userImage: users.image,
    })
    .from(apiTokens)
    .innerJoin(users, eq(users.id, apiTokens.ownerId))
    .where(
      and(
        eq(apiTokens.tokenHash, tokenHash),
        isNull(apiTokens.revokedAt),
        or(isNull(apiTokens.expiresAt), gt(apiTokens.expiresAt, nowAt)),
      ),
    );

  if (!record || !verifyHash(bearer, record.tokenHash)) {
    return null;
  }

  await db.update(apiTokens).set({ lastUsedAt: nowAt }).where(eq(apiTokens.id, record.id));

  return {
    authSource: "api-token",
    tokenId: record.id,
    user: mapUser({
      id: record.userId,
      name: record.userName,
      email: record.userEmail,
      image: record.userImage,
    }),
  };
}

export async function requireRequestAuth(request: Request): Promise<RequestAuth> {
  const result = await resolveRequestAuth(request);
  if (!result) {
    throw new Response(JSON.stringify({ error: "Authentication required" }), {
      status: 401,
      headers: { "content-type": "application/json" },
    });
  }

  return result;
}

export async function listApiTokens(ownerId: string): Promise<ApiTokenRecord[]> {
  const rows = await db
    .select()
    .from(apiTokens)
    .where(eq(apiTokens.ownerId, ownerId));

  return rows
    .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())
    .map((row) => ({
      id: row.id,
      label: row.label,
      prefix: row.prefix,
      lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
      expiresAt: row.expiresAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
      revokedAt: row.revokedAt?.toISOString() ?? null,
    }));
}

export async function createApiTokenForUser(ownerId: string, input: { label: string; ttl?: string }) {
  const token = createApiTokenValue();
  const createdAt = now();
  const expiresAt = input.ttl ? new Date(createdAt.getTime() + parseTtl(input.ttl)) : null;
  const record = {
    id: createAgfsId("tok"),
    ownerId,
    label: input.label,
    prefix: secretPrefix(token),
    tokenHash: hashSecret(token),
    createdAt,
    expiresAt,
    revokedAt: null,
    lastUsedAt: null,
  };

  await db.insert(apiTokens).values(record);

  return {
    token,
    record: {
      id: record.id,
      label: record.label,
      prefix: record.prefix,
      lastUsedAt: null,
      expiresAt: record.expiresAt?.toISOString() ?? null,
      createdAt: createdAt.toISOString(),
      revokedAt: null,
    } satisfies ApiTokenRecord,
  };
}

export async function revokeApiToken(ownerId: string, tokenId: string) {
  await db
    .update(apiTokens)
    .set({ revokedAt: now() })
    .where(and(eq(apiTokens.ownerId, ownerId), eq(apiTokens.id, tokenId)));
}

export async function startDeviceAuthorization(clientName: string) {
  const bindings = requireStringBindings("APP_URL");
  const deviceCode = createDeviceCode();
  const userCode = createUserCode();
  const expiresAt = new Date(Date.now() + 10 * 60_000);

  await db.insert(deviceCodes).values({
    deviceCode,
    userCode,
    label: clientName,
    intervalSeconds: 5,
    expiresAt,
  });

  return {
    deviceCode,
    userCode,
    verificationUri: `${bindings.APP_URL}/device`,
    verificationUriComplete: `${bindings.APP_URL}/device?user_code=${encodeURIComponent(userCode)}`,
    intervalSeconds: 5,
    expiresAt: expiresAt.toISOString(),
  };
}

export async function approveDeviceAuthorization(ownerId: string, input: {
  label: string;
  userCode: string;
}) {
  const [record] = await db
    .select()
    .from(deviceCodes)
    .where(eq(deviceCodes.userCode, input.userCode));

  if (!record) {
    throw new Error("Device code not found");
  }
  if (record.expiresAt.getTime() <= Date.now()) {
    throw new Error("Device code expired");
  }
  if (record.approvedAt) {
    throw new Error("Device code already approved");
  }

  const created = await createApiTokenForUser(ownerId, { label: input.label });

  await db
    .update(deviceCodes)
    .set({
      ownerId,
      apiTokenId: created.record.id,
      approvedAt: now(),
      accessTokenPlaintext: created.token,
      label: input.label,
    })
    .where(eq(deviceCodes.deviceCode, record.deviceCode));

  return created.record;
}

export async function pollDeviceAuthorization(deviceCode: string) {
  const [record] = await db
    .select()
    .from(deviceCodes)
    .where(eq(deviceCodes.deviceCode, deviceCode));

  if (!record) {
    throw new Error("Device code not found");
  }

  if (record.expiresAt.getTime() <= Date.now()) {
    return { status: "expired" as const };
  }

  if (record.approvedAt && record.accessTokenPlaintext && !record.consumedAt) {
    const accessToken = record.accessTokenPlaintext;
    await db
      .update(deviceCodes)
      .set({
        accessTokenPlaintext: null,
        consumedAt: now(),
      })
      .where(eq(deviceCodes.deviceCode, deviceCode));

    return {
      status: "approved" as const,
      accessToken,
      tokenType: "Bearer" as const,
      expiresAt: null,
    };
  }

  return {
    status: "pending" as const,
    intervalSeconds: record.intervalSeconds,
    expiresAt: record.expiresAt.toISOString(),
  };
}
