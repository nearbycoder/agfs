import { sql } from "drizzle-orm";
import type { RequestAuth } from "./authz";
import { authorize } from "./scope";
import { rows, first } from "./platform-db";
import { atomicBatch } from "./atomic-batch";
import { resourcePath, resourceCursor, resourcePage } from "./resource-controls";
import { queueObject } from "./garbage";

export async function uploadInventory(auth: RequestAuth, input: { path: string; status: string; tokenId?: string; before?: number; cursor?: string }) {
  const path = resourcePath(auth, input.path), { key, value } = resourceCursor(input.cursor, [auth.user.id, "uploads", path, input.status, input.tokenId, input.before]);
  // Page the owner's reservations first, then apply optional filters. This bounds
  // reads even when one token/path has no matches in a large retained history.
  const items = await rows(sql`SELECT id,path,status,size,created_at AS createdAt,expires_at AS expiresAt,token_id AS tokenId,
    CASE WHEN multipart_id IS NULL THEN 0 ELSE 1 END AS multipart,
    coalesce((SELECT uploaded_bytes FROM resource_upload_progress WHERE upload_id=u.id),0) AS uploadedBytes
    FROM uploads u WHERE owner_id=${auth.user.id} AND (created_at,id)>(${value?.at ?? -1},${value?.after ?? ""}) ORDER BY created_at,id LIMIT 51`);
  const page = resourcePage(items, key, (last) => ({ at: last.createdAt, after: last.id }));
  return { ...page, inspected: page.results.length, results: page.results.filter((r) =>
    (path === "/" || r.path === path || r.path.startsWith(path + "/")) &&
    (input.status === "active" ? ["pending", "completing"].includes(r.status) : r.status === input.status) &&
    (!input.tokenId || r.tokenId === input.tokenId) && (input.before === undefined || r.createdAt <= input.before)
  ).map((r) => ({ ...r, multipart: !!r.multipart, uploadedBytes: r.multipart ? r.uploadedBytes : null,
    reservedBytes: ["pending", "completing"].includes(r.status) ? r.size : 0 })) };
}
export async function abandonUploads(auth: RequestAuth, ids: string[], dryRun: boolean) {
  authorize(auth, "manage");
  const results: Array<Record<string, unknown>> = [];
  for (const id of ids) {
    const row = await first(sql`SELECT id,path,status,expires_at AS expiresAt FROM uploads WHERE id=${id} AND owner_id=${auth.user.id}`);
    if (!row) { results.push({ id, status: "unavailable" }); continue; }
    authorize(auth, "write", row.path);
    if (row.status !== "pending") { results.push({ id, status: row.status === "expired" ? "already-abandoned" : "not-pending" }); continue; }
    if (dryRun) { results.push({ id, path: row.path, status: "would-abandon", cleanupAfter: row.expiresAt }); continue; }
    const changed = await rows(sql`UPDATE uploads SET status='expired' WHERE id=${id} AND owner_id=${auth.user.id} AND path=${row.path} AND status='pending' RETURNING id`);
    results.push({ id, status: changed.length ? "abandoned" : "changed", cleanupAfter: row.expiresAt });
  }
  // Physical cleanup waits for the reservation's original expiry. Upload totals
  // are not refunded. In-flight PUT finalizers requeue their immutable object key
  // even if expiry cleanup already removed this reservation.
  return { results, dryRun, dailyUploadBudgetRefunded: false };
}

/** Called in direct PUT's finally, after R2 has settled, including failed writes. */
export async function reconcileDirectUpload(id: string, objectKey: string) {
  const row = await first(sql`SELECT status,object_key FROM uploads WHERE id=${id}`);
  if (!row || row.object_key !== objectKey || !["pending", "completing", "committed"].includes(row.status)) {
    await atomicBatch([queueObject(objectKey)]);
    return false;
  }
  return true;
}
