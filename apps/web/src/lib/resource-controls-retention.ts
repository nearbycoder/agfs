import { sql } from "drizzle-orm";
import type { RequestAuth } from "./authz";
import { authorize } from "./scope";
import { rows, first } from "./platform-db";
import { resourcePath, resourceCursor, resourcePage, requireOwned } from "./resource-controls";
import { errorResponse } from "./http";

export async function retentionReferences(auth: RequestAuth, input: { path: string; cursor?: string }) {
  const path = resourcePath(auth, input.path), { key, value } = resourceCursor(input.cursor, [auth.user.id, "references", path]);
  const entry = requireOwned(await first(sql`SELECT r2_key,etag FROM entries WHERE owner_id=${auth.user.id} AND path=${path} AND kind='file'`), "File not found");
  const after = (prefix: string) => !value || prefix + ":" > value.after ? "" : value.after.startsWith(prefix + ":") ? value.after.slice(prefix.length + 1) : null;
  const liveAfter = after("live"), recoveryAfter = after("recovery"), pinAfter = after("pin");
  // Each arm is separately capped before merging; no unbounded reference sort.
  const items = await rows(sql`WITH live AS MATERIALIZED (
      SELECT 'live:'||id AS position,'live' AS kind,id AS referenceId,path AS name,NULL AS expiresAt,1 AS protecting FROM entries
      WHERE owner_id=${auth.user.id} AND r2_key=${entry.r2_key} AND ${liveAfter} IS NOT NULL AND id>${liveAfter ?? ""} ORDER BY id LIMIT 51),
    recovered AS MATERIALIZED (
      SELECT 'recovery:'||id AS position,reason AS kind,id AS referenceId,path AS name,expires_at AS expiresAt,1 AS protecting FROM recovery
      WHERE owner_id=${auth.user.id} AND r2_key=${entry.r2_key} AND ${recoveryAfter} IS NOT NULL AND id>${recoveryAfter ?? ""} ORDER BY id LIMIT 51),
    pinned AS MATERIALIZED (
      SELECT 'pin:'||p.reference_id AS position,CASE WHEN s.id IS NOT NULL THEN 'snapshot' WHEN r.id IS NOT NULL THEN 'run' ELSE 'pin' END AS kind,
        p.reference_id AS referenceId,coalesce(s.name,r.name,'Retained object') AS name,p.expires_at AS expiresAt,
        p.expires_at>unixepoch()*1000 AS protecting
      FROM object_pins p LEFT JOIN snapshots s ON s.id=p.reference_id AND s.owner_id=p.owner_id LEFT JOIN agent_runs r ON r.id=p.reference_id AND r.owner_id=p.owner_id
      WHERE p.owner_id=${auth.user.id} AND p.object_key=${entry.r2_key} AND ${pinAfter} IS NOT NULL AND p.reference_id>${pinAfter ?? ""} ORDER BY p.reference_id LIMIT 51)
    SELECT * FROM live UNION ALL SELECT * FROM recovered UNION ALL SELECT * FROM pinned ORDER BY position LIMIT 51`);
  const page = resourcePage(items, key, (last) => ({ after: last.position }));
  // Filter after the bounded page, using database execution time just like GC.
  // An expired-only page still returns its continuation to later active pins.
  return { ...page, path, etag: entry.etag, results: page.results.filter((r) => r.protecting).map(({ position: _, protecting: __, ...r }) => r), generatedAt: Date.now() };
}
export async function retentionExpiring(auth: RequestAuth, input: { days: number; cursor?: string }) {
  authorize(auth, "manage");
  const { key, value } = resourceCursor(input.cursor, [auth.user.id, "expiry", input.days]);
  if (value && (!Number.isSafeInteger(Number(value.after)) || Number(value.after) < 0)) throw errorResponse(400, "Invalid pagination cursor");
  const until = value?.until ?? Date.now() + input.days * 86400000, start = until - input.days * 86400000;
  const afterAt = value?.at ?? start - 1, afterId = Number(value?.after ?? 0);
  const items = await rows(sql`WITH same_expiry AS MATERIALIZED (
      SELECT rowid AS position,expires_at FROM object_pins INDEXED BY pins_owner_expiry
      WHERE owner_id=${auth.user.id} AND expires_at=${afterAt} AND rowid>${afterId}
        AND expires_at>=${start} AND expires_at<=${until} ORDER BY rowid LIMIT 51),
    later_expiry AS MATERIALIZED (
      SELECT rowid AS position,expires_at FROM object_pins INDEXED BY pins_owner_expiry
      WHERE owner_id=${auth.user.id} AND expires_at>${Math.max(afterAt, start - 1)} AND expires_at<=${until}
      ORDER BY expires_at,rowid LIMIT 51),
    selected AS MATERIALIZED (SELECT * FROM same_expiry UNION ALL SELECT * FROM later_expiry ORDER BY expires_at,position LIMIT 51)
    SELECT p.rowid AS position,p.reference_id AS referenceId,p.expires_at AS expiresAt,
    CASE WHEN s.id IS NOT NULL THEN 'snapshot' WHEN r.id IS NOT NULL THEN 'run' ELSE 'pin' END AS kind,
    coalesce(s.name,r.name,'Retained object') AS name,u.size AS bytes
    FROM selected c CROSS JOIN object_pins p ON p.rowid=c.position LEFT JOIN snapshots s ON s.id=p.reference_id AND s.owner_id=p.owner_id
    LEFT JOIN agent_runs r ON r.id=p.reference_id AND r.owner_id=p.owner_id LEFT JOIN object_usage u ON u.object_key=p.object_key AND u.owner_id=p.owner_id
    WHERE p.owner_id=${auth.user.id} ORDER BY p.expires_at,p.rowid`);
  const page = resourcePage(items, key, (last) => ({ at: last.expiresAt, after: String(last.position), until }));
  return { ...page, from: start, through: until, results: page.results.map(({ position: _, ...r }) => r),
    semantics: "One row per object pin. Expiry removes this retention reference; live files or other pins can still retain the same bytes." };
}
export async function cleanupWebhookHistory(auth: RequestAuth, ids: string[], dryRun: boolean) {
  authorize(auth, "manage");
  const encoded = JSON.stringify(ids);
  const eligible = await rows(sql`SELECT d.id,d.status,length(CAST(d.payload AS BLOB)) AS payloadBytes FROM json_each(${encoded}) j
    JOIN webhook_deliveries d ON d.id=j.value JOIN webhooks w ON w.id=d.webhook_id
    WHERE w.owner_id=${auth.user.id} AND d.status IN ('delivered','failed')`);
  const deleted = dryRun ? [] : await rows(sql`DELETE FROM webhook_deliveries WHERE id IN (SELECT value FROM json_each(${encoded}))
    AND status IN ('delivered','failed') AND webhook_id IN (SELECT id FROM webhooks WHERE owner_id=${auth.user.id}) RETURNING id`);
  return { dryRun, eligible: eligible.map((r) => ({ id: r.id, status: r.status })), payloadBytes: eligible.reduce((n, r) => n + r.payloadBytes, 0),
    deleted: deleted.map((r) => r.id), note: "Failed terminal deliveries removed here cannot be retried." };
}
