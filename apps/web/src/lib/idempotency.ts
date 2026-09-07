import { sql } from "drizzle-orm";
import { hashSecret } from "@agfs/db";
import { first, rows } from "./platform-db";
import { requireRequestAuth } from "./authz";
import { authorize } from "./scope";
import { actorId } from "./workspaces";
import { requireStringBindings } from "./bindings";
import { sealDeviceToken, openDeviceToken } from "./device-token";
import { errorResponse } from "./http";
// Only bounded JSON creation endpoints; never cache upload/download streams.
const routes = new Map<string, "write" | "share">([
  ["/api/v1/platform/runs", "write"],
  ["/api/v1/platform/drafts", "write"],
  ["/api/v1/shares", "share"],
  ["/api/v1/fs/upload-intents", "write"],
  ["/api/v1/fs/resumable", "write"],
]);
export async function idempotent(
  request: Request,
  execute: () => Promise<Response>,
) {
  const key = request.headers.get("idempotency-key"),
    route = new URL(request.url).pathname,
    permission = routes.get(route);
  if (!key) return execute();
  if (request.method !== "POST" || !permission)
    throw errorResponse(
      400,
      "Idempotency keys are supported on creation endpoints only",
    );
  if (!/^[\x21-\x7e]{8,128}$/.test(key))
    throw errorResponse(
      400,
      "Idempotency-Key must contain 8–128 printable characters",
    );
  const auth = await requireRequestAuth(request),
    body = await request.clone().text();
  let input: any;
  try {
    input = JSON.parse(body);
  } catch {
    throw errorResponse(400, "Invalid JSON");
  }
  if (typeof input.path !== "string")
    throw errorResponse(400, "A path is required");
  authorize(auth, permission, input.path);
  const identity = JSON.stringify([
      actorId(auth),
      auth.tokenId ?? "session",
      auth.pathPrefix,
      auth.permissions,
    ]),
    fingerprint = hashSecret(identity + route + body),
    keyHash = hashSecret(identity + key);
  const inserted = await first(
    sql`INSERT INTO idempotency(owner_id,key_hash,fingerprint,created_at) SELECT ${auth.user.id},${keyHash},${fingerprint},${Date.now()} WHERE (SELECT count(*) FROM idempotency WHERE owner_id=${auth.user.id})<10000 ON CONFLICT(owner_id,key_hash) DO NOTHING RETURNING key_hash`,
  );
  const secret = requireStringBindings("BETTER_AUTH_SECRET").BETTER_AUTH_SECRET;
  if (!inserted) {
    const existing = await first(
      sql`SELECT * FROM idempotency WHERE owner_id=${auth.user.id} AND key_hash=${keyHash}`,
    );
    if (!existing) throw errorResponse(429, "Idempotency capacity reached");
    if (existing.fingerprint !== fingerprint)
      throw errorResponse(
        409,
        "Idempotency key already used for a different request",
      );
    if (!existing.response)
      throw new Response(
        JSON.stringify({
          error:
            "Request still running or its outcome is uncertain; inspect the resource before using a new key",
        }),
        {
          status: 409,
          headers: { "content-type": "application/json", "retry-after": "5" },
        },
      );
    const saved = JSON.parse(openDeviceToken(existing.response, secret));
    return new Response(saved.body, {
      status: existing.status,
      headers: {
        "content-type": "application/json",
        "idempotency-replayed": "true",
      },
    });
  }
  // A crash or server failure leaves a reservation; retrying cannot create a duplicate.
  const result = await execute();
  if (result.status < 500) {
    const body = await result.clone().text();
    if (body.length <= 262144)
      await rows(
        sql`UPDATE idempotency SET status=${result.status},response=${sealDeviceToken(JSON.stringify({ body }), secret)} WHERE owner_id=${auth.user.id} AND key_hash=${keyHash}`,
      );
  }
  return result;
}
