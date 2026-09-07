import { sql } from "drizzle-orm";
import type { RequestAuth } from "./authz";
import { first, rows } from "./platform-db";
import { errorResponse } from "./http";
import { authorize } from "./scope";
export const usageDay = () => new Date().toISOString().slice(0, 10);
export async function chargeOperation(auth: RequestAuth) {
  if (!auth.tokenId) return;
  const used = await rows(sql`INSERT INTO agent_usage(token_id,day,operations)
    SELECT ${auth.tokenId},${usageDay()},1 WHERE EXISTS(SELECT 1 FROM api_tokens WHERE id=${auth.tokenId} AND paused=0 AND (operation_limit IS NULL OR operation_limit>0))
    ON CONFLICT(token_id,day) DO UPDATE SET operations=operations+1
    WHERE operations<coalesce((SELECT operation_limit FROM api_tokens WHERE id=${auth.tokenId}),9223372036854775807)
    RETURNING operations`);
  if (!used.length)
    throw errorResponse(
      429,
      "Agent daily operation budget reached or agent paused",
    );
}
export function tokenStorageSql(tokenId: string) {
  return sql`(SELECT coalesce(sum(size),0) FROM object_usage WHERE token_id=${tokenId})`;
}
export async function listBudgets(auth: RequestAuth) {
  authorize(auth, "manage");
  return rows(sql`SELECT t.id,t.label,t.path_prefix,t.paused,t.storage_limit,t.upload_limit,t.operation_limit,
    coalesce(u.operations,0) AS operations,coalesce(u.upload_bytes,0) AS upload_bytes,
    (SELECT coalesce(sum(size),0) FROM object_usage o WHERE o.token_id=t.id) AS storage_bytes
    FROM api_tokens t LEFT JOIN agent_usage u ON u.token_id=t.id AND u.day=${usageDay()}
    WHERE t.owner_id=${auth.user.id} AND t.revoked_at IS NULL ORDER BY t.created_at DESC`);
}
export async function updateBudget(
  auth: RequestAuth,
  id: string,
  input: {
    paused: boolean;
    storageLimit: number | null;
    uploadLimit: number | null;
    operationLimit: number | null;
  },
) {
  authorize(auth, "manage");
  const row =
    await first(sql`UPDATE api_tokens SET paused=${input.paused ? 1 : 0},storage_limit=${input.storageLimit},
    upload_limit=${input.uploadLimit},operation_limit=${input.operationLimit}
    WHERE id=${id} AND owner_id=${auth.user.id} RETURNING id`);
  if (!row) throw errorResponse(404, "Token not found");
  return row;
}
