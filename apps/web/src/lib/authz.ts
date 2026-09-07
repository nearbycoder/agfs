import { sql } from "drizzle-orm";
import { first } from "./platform-db";
import { requestContext } from "./request-context";
import { ALL_PERMISSIONS, type Permission } from "./scope";
import { and, eq, gt, isNull, or, lte } from "drizzle-orm";
import {
  normalizeAgfsPath,
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
import { openDeviceToken, sealDeviceToken } from "./device-token";
import { auth } from "./auth";
import { requireStringBindings } from "./bindings";
import { db } from "./db";
import {
  getBearerToken,
  requireSameOriginMutation,
  errorResponse,
} from "./http";

export interface RequestAuth {
  authSource: "session" | "api-token";
  tokenId?: string;
  tokenLabel?: string;
  pathPrefix?: string;
  permissions?: Permission[];
  user: SessionUser;
  actor?: SessionUser;
  workspaceId?: string;
  workspaceRole?: "owner" | "editor" | "viewer";
  workspacePaused?: boolean;
}

function mapUser(row: {
  id: string;
  name: string | null;
  email: string;
  image?: string | null;
}): SessionUser {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    image: row.image ?? null,
  };
}

export async function resolveRequestAuth(
  request: Request,
): Promise<RequestAuth | null> {
  const session = getBearerToken(request)
    ? null
    : await auth.api.getSession({
        headers: request.headers,
      });

  if (session?.user) {
    requireSameOriginMutation(
      request,
      requireStringBindings("APP_URL").APP_URL,
    );
    return {
      authSource: "session",
      user: mapUser(session.user),
    };
  }

  const bearer = getBearerToken(request);
  if (!bearer) {
    return null;
  }

  if (bearer.includes("."))
    return (await import("./oauth")).resolveOAuth(request, bearer);
  if (request.headers.get("authorization")?.toLowerCase().startsWith("dpop "))
    return null;
  const tokenHash = hashSecret(bearer);
  const alias = await first(
    sql`SELECT token_id,token_hash FROM token_rotation_aliases WHERE token_hash=${tokenHash} AND expires_at>${Date.now()}`,
  );
  const nowAt = now();
  const [record] = await db
    .select({
      id: apiTokens.id,
      ownerId: apiTokens.ownerId,
      label: apiTokens.label,
      prefix: apiTokens.prefix,
      pathPrefix: apiTokens.pathPrefix,
      issuedBy: apiTokens.issuedBy,
      paused: apiTokens.paused,
      permissions: apiTokens.permissions,
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
        or(
          eq(apiTokens.tokenHash, tokenHash),
          eq(apiTokens.id, alias?.token_id ?? ""),
        ),
        isNull(apiTokens.revokedAt),
        or(isNull(apiTokens.expiresAt), gt(apiTokens.expiresAt, nowAt)),
      ),
    );

  if (
    !record ||
    record.paused ||
    !(
      verifyHash(bearer, record.tokenHash) ||
      (alias && verifyHash(bearer, alias.token_hash))
    )
  ) {
    return null;
  }

  await db
    .update(apiTokens)
    .set({ lastUsedAt: nowAt })
    .where(
      and(
        eq(apiTokens.id, record.id),
        or(
          isNull(apiTokens.lastUsedAt),
          lte(apiTokens.lastUsedAt, new Date(Date.now() - 60000)),
        ),
      ),
    );

  const issuer = record.issuedBy
    ? (await db.select().from(users).where(eq(users.id, record.issuedBy)))[0]
    : null;
  return {
    actor: issuer ? mapUser(issuer) : undefined,
    workspaceId: record.userId.startsWith("ws_") ? record.userId : undefined,
    authSource: "api-token",
    tokenId: record.id,
    tokenLabel: record.label,
    pathPrefix: record.pathPrefix,
    permissions: JSON.parse(record.permissions),
    user: mapUser({
      id: record.userId,
      name: record.userName,
      email: record.userEmail,
      image: record.userImage,
    }),
  };
}

export async function requireRequestAuth(
  request: Request,
  personal = false,
  charge = true,
): Promise<RequestAuth> {
  let result = await resolveRequestAuth(request);
  if (!result) {
    throw new Response(JSON.stringify({ error: "Authentication required" }), {
      status: 401,
      headers: { "content-type": "application/json" },
    });
  }

  if (!personal)
    result = await (
      await import("./workspaces")
    ).selectNamespace(request, result);
  const context = requestContext.getStore();
  if (charge && result.tokenId && !context?.budgetCharged) {
    await (await import("./budgets")).chargeOperation(result);
    if (context) context.budgetCharged = true;
  }
  if (context) context.auth = result;
  if (!context?.burstCharged) {
    await (await import("./operations")).limitOperation(request, result);
    if (context) context.burstCharged = true;
  }
  return result;
}

export async function listApiTokens(
  ownerId: string,
): Promise<ApiTokenRecord[]> {
  const rows = await db
    .select()
    .from(apiTokens)
    .where(eq(apiTokens.ownerId, ownerId));

  return rows
    .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())
    .map((row) => ({
      id: row.id,
      label: row.label,
      pathPrefix: row.pathPrefix,
      permissions: JSON.parse(row.permissions),
      prefix: row.prefix,
      lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
      expiresAt: row.expiresAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
      revokedAt: row.revokedAt?.toISOString() ?? null,
    }));
}

export async function createApiTokenForUser(
  ownerId: string,
  input: {
    label: string;
    ttl?: string;
    pathPrefix?: string;
    permissions?: Permission[];
    issuedBy?: string;
  },
) {
  const token = createApiTokenValue();
  const createdAt = now();
  const expiresAt = new Date(
    createdAt.getTime() + parseTtl(input.ttl ?? "30d", { maxDays: 90 }),
  );
  const record = {
    id: createAgfsId("tok"),
    ownerId,
    label: input.label,
    issuedBy: input.issuedBy ?? ownerId,
    pathPrefix: normalizeAgfsPath(input.pathPrefix ?? "/"),
    permissions: JSON.stringify(input.permissions ?? ALL_PERMISSIONS),
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
      pathPrefix: record.pathPrefix,
      permissions: JSON.parse(record.permissions),
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
  await db
    .update(deviceCodes)
    .set({ accessTokenPlaintext: null })
    .where(lte(deviceCodes.expiresAt, now()));
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

export async function approveDeviceAuthorization(
  ownerId: string,
  input: {
    label: string;
    userCode: string;
  },
) {
  const [record] = await db
    .select()
    .from(deviceCodes)
    .where(eq(deviceCodes.userCode, input.userCode));

  if (!record) {
    throw errorResponse(400, "Device code not found");
  }
  if (record.expiresAt.getTime() <= Date.now()) {
    throw errorResponse(400, "Device code expired");
  }
  if (record.approvedAt) {
    throw errorResponse(400, "Device code already approved");
  }

  const [claimed] = await db
    .update(deviceCodes)
    .set({ approvedAt: now(), ownerId })
    .where(
      and(
        eq(deviceCodes.deviceCode, record.deviceCode),
        isNull(deviceCodes.approvedAt),
        gt(deviceCodes.expiresAt, now()),
      ),
    )
    .returning({ deviceCode: deviceCodes.deviceCode });
  if (!claimed)
    throw errorResponse(409, "Device code already approved or expired");
  const created = await createApiTokenForUser(ownerId, { label: input.label });

  await db
    .update(deviceCodes)
    .set({
      ownerId,
      apiTokenId: created.record.id,
      approvedAt: now(),
      accessTokenPlaintext: sealDeviceToken(
        created.token,
        requireStringBindings("BETTER_AUTH_SECRET").BETTER_AUTH_SECRET,
      ),
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
    throw errorResponse(400, "Device code not found");
  }

  if (record.consumedAt || record.expiresAt.getTime() <= Date.now()) {
    return { status: "expired" as const };
  }

  if (record.approvedAt && record.accessTokenPlaintext && !record.consumedAt) {
    const accessToken = record.accessTokenPlaintext;
    const [consumed] = await db
      .update(deviceCodes)
      .set({
        accessTokenPlaintext: null,
        consumedAt: now(),
      })
      .where(
        and(
          eq(deviceCodes.deviceCode, deviceCode),
          isNull(deviceCodes.consumedAt),
          gt(deviceCodes.expiresAt, now()),
        ),
      )
      .returning({ deviceCode: deviceCodes.deviceCode });
    if (!consumed) return { status: "expired" as const };

    return {
      status: "approved" as const,
      accessToken: openDeviceToken(
        accessToken,
        requireStringBindings("BETTER_AUTH_SECRET").BETTER_AUTH_SECRET,
      ),
      tokenType: "Bearer" as const,
      expiresAt: new Date(
        record.approvedAt.getTime() + 30 * 86_400_000,
      ).toISOString(),
    };
  }

  return {
    status: "pending" as const,
    intervalSeconds: record.intervalSeconds,
    expiresAt: record.expiresAt.toISOString(),
  };
}
