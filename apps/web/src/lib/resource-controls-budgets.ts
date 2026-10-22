import { sql } from "drizzle-orm";
import type { z } from "zod";
import type { budgetUpdateSchema, BudgetTokensResult } from "@agfs/contracts";
import type { RequestAuth } from "./authz";
import { authorize } from "./scope";
import { rows, first } from "./platform-db";
import { requireOwned, resourceCursor, resourcePage } from "./resource-controls";
import { errorResponse } from "./http";

export async function budgetTokens(auth: RequestAuth, cursor?: string): Promise<BudgetTokensResult> {
  authorize(auth, "manage");
  const { key, value } = resourceCursor(cursor, [auth.user.id, "budget-tokens", "non-revoked"]);
  // Keep expired and paused tokens visible for budget/history management, as in
  // the existing selector. No usage/storage aggregates or per-token requests.
  const items = await rows(sql`SELECT id,label,path_prefix AS pathPrefix,paused,
    storage_limit AS storageLimit,upload_limit AS uploadLimit,operation_limit AS operationLimit
    FROM api_tokens WHERE owner_id=${auth.user.id} AND revoked_at IS NULL AND id>${value?.after ?? ""} ORDER BY id LIMIT 51`);
  const page = resourcePage(items, key, (last) => ({ after: last.id }));
  return { ...page, results: page.results.map((r) => ({ id: r.id, label: r.label, pathPrefix: r.pathPrefix, paused: !!r.paused,
    storageLimit: r.storageLimit, uploadLimit: r.uploadLimit, operationLimit: r.operationLimit })) };
}

export async function budgetHistory(auth: RequestAuth, tokenId: string, days: number) {
  authorize(auth, "manage");
  const at = Date.now(), today = new Date(at).toISOString().slice(0, 10),
    from = new Date(at - (days - 1) * 86400000).toISOString().slice(0, 10);
  const result = await rows(sql`SELECT t.id,t.label,u.day,coalesce(u.operations,0) AS operations,coalesce(u.upload_bytes,0) AS uploadBytes
    FROM api_tokens t LEFT JOIN agent_usage u ON u.token_id=t.id AND u.day>=${from} AND u.day<=${today}
    WHERE t.id=${tokenId} AND t.owner_id=${auth.user.id} ORDER BY u.day LIMIT 90`);
  requireOwned(result[0], "Token not found");
  return { token: { id: tokenId, label: result[0].label }, from, through: today, timezone: "UTC", retentionDays: 90,
    results: result.filter((r) => r.day != null).map(({ day, operations, uploadBytes }) => ({ day, operations, uploadBytes })) };
}
export async function budgetPreflight(auth: RequestAuth, input: { tokenId: string; operations: number; uploadBytes: number; storageBytes: number }) {
  authorize(auth, "manage");
  const at = Date.now(), day = new Date(at).toISOString().slice(0, 10);
  const t = requireOwned(await first(sql`SELECT t.id,t.paused,t.revoked_at,t.expires_at,t.operation_limit,t.upload_limit,t.storage_limit,
    coalesce(u.operations,0) AS operations,coalesce(u.upload_bytes,0) AS uploadBytes,
    coalesce((SELECT bytes FROM resource_token_storage WHERE token_id=t.id),0) AS storageBytes,
    (SELECT coalesce(sum(size),0) FROM uploads WHERE token_id=t.id AND status IN ('pending','completing')) AS reservedBytes
    FROM api_tokens t LEFT JOIN agent_usage u ON u.token_id=t.id AND u.day=${day} WHERE t.id=${input.tokenId} AND t.owner_id=${auth.user.id}`), "Token not found");
  const remaining = (limit: number | null, used: number) => limit === null ? null : Math.max(0, limit - used);
  const capacity = { operations: remaining(t.operation_limit, t.operations), uploadBytes: remaining(t.upload_limit, t.uploadBytes), storageBytes: remaining(t.storage_limit, t.storageBytes + t.reservedBytes) };
  const blockers: string[] = [];
  if (t.paused) blockers.push("paused");
  if (t.revoked_at != null) blockers.push("revoked");
  if (t.expires_at != null && t.expires_at <= at) blockers.push("expired");
  for (const kind of ["operations", "uploadBytes", "storageBytes"] as const)
    if (capacity[kind] !== null && input[kind] > capacity[kind]) blockers.push(kind);
  return { advisory: true, allowedByAgentBudget: !blockers.length, blockers, remaining: capacity,
    used: { operations: t.operations, uploadBytes: t.uploadBytes, storageBytes: t.storageBytes, reservedBytes: t.reservedBytes },
    resetsAt: new Date(Date.parse(day) + 86400000).toISOString(),
    constraints: "Snapshot of agent budgets only; account/workspace quotas, permissions, concurrent reservations, and the request's own operation charge still apply. No capacity is reserved." };
}
export async function batchBudgets(auth: RequestAuth, updates: Array<z.infer<typeof budgetUpdateSchema>>) {
  authorize(auth, "manage");
  const payload = JSON.stringify(updates);
  // The ownership guard and every mutation are one SQL statement. A concurrent
  // ownership change cannot produce a partially applied batch.
  const result = await rows(sql`UPDATE api_tokens SET
    paused=(SELECT json_extract(value,'$.paused') FROM json_each(${payload}) WHERE json_extract(value,'$.id')=api_tokens.id),
    storage_limit=(SELECT json_extract(value,'$.storageLimit') FROM json_each(${payload}) WHERE json_extract(value,'$.id')=api_tokens.id),
    upload_limit=(SELECT json_extract(value,'$.uploadLimit') FROM json_each(${payload}) WHERE json_extract(value,'$.id')=api_tokens.id),
    operation_limit=(SELECT json_extract(value,'$.operationLimit') FROM json_each(${payload}) WHERE json_extract(value,'$.id')=api_tokens.id)
    WHERE owner_id=${auth.user.id} AND id IN (SELECT json_extract(value,'$.id') FROM json_each(${payload}))
      AND (SELECT count(*) FROM json_each(${payload}) j JOIN api_tokens t ON t.id=json_extract(j.value,'$.id') WHERE t.owner_id=${auth.user.id})=${updates.length}
    RETURNING id`);
  if (result.length !== updates.length) throw errorResponse(409, "Every token must still belong to this namespace; no budgets changed");
  return { updated: result.map((r) => r.id) };
}
