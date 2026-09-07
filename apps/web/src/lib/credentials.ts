import { sql } from "drizzle-orm";
import {
  createApiTokenValue,
  createAgfsId,
  hashSecret,
  secretPrefix,
} from "@agfs/db";
import { first, rows } from "./platform-db";
import { atomicBatch } from "./atomic-batch";
import { authorize } from "./scope";
import { errorResponse } from "./http";
import type { RequestAuth } from "./authz";
export async function rotateToken(auth: RequestAuth, id: string) {
  authorize(auth, "manage");
  if (auth.authSource !== "session")
    throw errorResponse(403, "Rotate credentials in the browser");
  const token = createApiTokenValue(),
    until = Date.now() + 15 * 60000,
    old = await first(
      sql`SELECT * FROM api_tokens WHERE id=${id} AND owner_id=${auth.user.id} AND revoked_at IS NULL AND expires_at>${Date.now()}`,
    );
  if (
    !old ||
    (await first(
      sql`SELECT id FROM oauth_consent WHERE reference_id=${id} LIMIT 1`,
    ))
  )
    throw errorResponse(
      409,
      "Token missing, expired, or managed through OAuth",
    );
  const guard = sql`id=${id} AND owner_id=${auth.user.id} AND token_hash=${old.token_hash} AND revoked_at IS NULL AND expires_at>${Date.now()}`;
  const result = await atomicBatch([
    sql`DELETE FROM token_rotation_aliases WHERE token_id=${id} AND EXISTS(SELECT 1 FROM api_tokens WHERE ${guard})`,
    sql`INSERT INTO token_rotation_aliases SELECT token_hash,id,min(expires_at,${until}) FROM api_tokens WHERE ${guard}`,
    sql`UPDATE api_tokens SET token_hash=${hashSecret(token)},prefix=${secretPrefix(token)} WHERE ${guard} RETURNING id`,
  ]);
  if (!result[2].results.length)
    throw errorResponse(409, "Token changed; retry rotation");
  return {
    token,
    overlapUntil: Math.min(until, old.expires_at),
    expiresAt: old.expires_at,
  };
}
export async function rotateWebhook(auth: RequestAuth, id: string) {
  authorize(auth, "manage");
  if (auth.authSource !== "session")
    throw errorResponse(403, "Rotate secrets in the browser");
  const secret = createAgfsId("whsec"),
    until = Date.now() + 15 * 60000;
  const result = await rows(
    sql`UPDATE webhooks SET previous_secret=secret,previous_secret_until=${until},secret=${secret} WHERE id=${id} AND owner_id=${auth.user.id} RETURNING id`,
  );
  if (!result.length) throw errorResponse(404, "Webhook not found");
  return { secret, overlapUntil: until };
}
