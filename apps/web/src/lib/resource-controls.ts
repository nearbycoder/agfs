import { sql } from "drizzle-orm";
import { normalizeAgfsPath, hashSecret } from "@agfs/db";
import type { BackgroundPolicy, IndexingPolicy, IndexingPolicyResult } from "@agfs/contracts";
import { OPERATIONS_CURSOR_MAX_LENGTH } from "@agfs/contracts";
import type { RequestAuth } from "./authz";
import { authorize } from "./scope";
import { rows, first } from "./platform-db";
import { atomicBatch } from "./atomic-batch";
import { errorResponse } from "./http";
import { pathRange } from "./path-range";

export function resourcePath(auth: RequestAuth, path: string) {
  authorize(auth, "manage");
  const normalized = normalizeAgfsPath(path);
  authorize(auth, "read", normalized);
  return normalized;
}
export function resourceCursor(cursor: string | undefined, scope: unknown[], base = "") {
  const key = hashSecret(JSON.stringify(scope));
  let value: { key: string; after: string; at?: number; until?: number } | undefined;
  if (cursor) {
    try {
      if (cursor.length > OPERATIONS_CURSOR_MAX_LENGTH) throw new Error();
      const parts = cursor.split(".");
      if (parts.length !== 4 || parts[0] !== key || !/^\d{0,16}$/.test(parts[1]) || !/^\d{0,16}$/.test(parts[2]) || !/^[A-Za-z0-9_-]*$/.test(parts[3])) throw new Error();
      const bytes = Buffer.from(parts[3], "base64url");
      if (bytes.length % 2 || bytes.toString("base64url") !== parts[3]) throw new Error();
      value = { key, after: base + bytes.toString("utf16le"),
        ...(parts[1] ? { at: Number(parts[1]) } : {}), ...(parts[2] ? { until: Number(parts[2]) } : {}) };
      if (value.after.length > 4096 ||
        (value.at !== undefined && !Number.isSafeInteger(value.at)) || (value.until !== undefined && !Number.isSafeInteger(value.until))) throw new Error();
    } catch { throw errorResponse(400, "Invalid pagination cursor"); }
  }
  return { key, value };
}
export function resourcePage<T>(items: T[], key: string, position: (last: T) => { after: string; at?: number; until?: number }, base = "") {
  const results = items.slice(0, 50);
  if (items.length <= 50) return { results, nextCursor: null };
  const last = position(results[49]);
  if (!last.after.startsWith(base)) throw new Error("Pagination position outside scope");
  return { results, nextCursor: [key, last.at ?? "", last.until ?? "", Buffer.from(last.after.slice(base.length), "utf16le").toString("base64url")].join(".") };
}
export async function indexingPolicy(auth: RequestAuth, input?: IndexingPolicy): Promise<IndexingPolicyResult> {
  authorize(auth, "manage");
  if (input) await rows(sql`INSERT INTO resource_policies(owner_id,index_mode,max_text_bytes) VALUES(${auth.user.id},${input.mode},${input.maxTextBytes})
    ON CONFLICT(owner_id) DO UPDATE SET index_mode=excluded.index_mode,max_text_bytes=excluded.max_text_bytes`);
  const policy = await first(sql`SELECT index_mode AS mode,max_text_bytes AS maxTextBytes,revision FROM resource_policies WHERE owner_id=${auth.user.id}`);
  return { mode: policy?.mode ?? "content", maxTextBytes: policy?.maxTextBytes ?? 1048576, revision: policy?.revision ?? 0, reindexRequired: !!input };
}
export async function backgroundPolicy(auth: RequestAuth, input?: BackgroundPolicy) {
  authorize(auth, "manage");
  if (input) await rows(sql`INSERT INTO resource_policies(owner_id,indexing_paused,webhooks_paused) VALUES(${auth.user.id},${Number(input.indexingPaused)},${Number(input.webhooksPaused)})
    ON CONFLICT(owner_id) DO UPDATE SET indexing_paused=excluded.indexing_paused,webhooks_paused=excluded.webhooks_paused`);
  const policy = await first(sql`SELECT indexing_paused,webhooks_paused FROM resource_policies WHERE owner_id=${auth.user.id}`);
  return { indexingPaused: !!policy?.indexing_paused, webhooksPaused: !!policy?.webhooks_paused, maintenanceContinues: true };
}
export function indexingReason(entry: { kind: string; size: number; contentType: string | null }, policy: { mode: string; maxTextBytes: number }) {
  if (entry.kind !== "file") return "folder";
  if (policy.mode === "metadata") return "metadata-policy";
  if (entry.size > policy.maxTextBytes) return "size-policy";
  if (!/^(text\/|application\/(json|xml|javascript|x-yaml))/.test(entry.contentType ?? "")) return "unsupported-type";
  return "eligible";
}
export async function indexDiagnostics(auth: RequestAuth, input: { path: string; state: string; cursor?: string }) {
  const path = resourcePath(auth, input.path), { key, value } = resourceCursor(input.cursor, [auth.user.id, "index", path, input.state], path);
  // State filtering happens on this bounded candidate page; an empty result page
  // can still have a continuation. It never scans an entire tree for 50 failures.
  const entries = await rows(sql`SELECT e.id,e.path,e.kind,e.size,e.content_type AS contentType,
    s.queued_at AS queuedAt,s.attempts,s.last_error AS lastError,s.next_attempt AS nextAttempt,
    d.indexed_at AS indexedAt,CASE WHEN d.object_key IS e.r2_key AND d.indexed_at>0 THEN 1 ELSE 0 END AS current,
    coalesce(p.index_mode,'content') AS mode,coalesce(p.max_text_bytes,1048576) AS maxTextBytes
    FROM entries e LEFT JOIN index_job_status s ON s.entry_id=e.id LEFT JOIN search_documents d ON d.entry_id=e.id
    LEFT JOIN resource_policies p ON p.owner_id=e.owner_id
    WHERE e.owner_id=${auth.user.id} AND ${pathRange(sql`e.path`, path, true)} AND e.path>${value?.after ?? ""} ORDER BY e.path LIMIT 51`);
  const page = resourcePage(entries, key, (last) => ({ after: last.path }), path);
  return { ...page, inspected: page.results.length, results: page.results.map(({ mode, maxTextBytes, current, ...e }) => ({ ...e,
    state: e.queuedAt != null ? (e.attempts > 0 ? "failed" : "pending") : current ? "current" : "missing",
    contentReason: indexingReason(e as any, { mode, maxTextBytes }),
  })).filter((e) => input.state === "all" || e.state === input.state) };
}
export { reindexPlan } from "./resource-controls-reindex";
export async function maintenanceStatus(auth: RequestAuth) {
  authorize(auth, "manage");
  const at = Date.now();
  const [progress, index, webhook, health] = await atomicBatch([
    sql`SELECT last_dispatch_at AS lastDispatchAt,last_health_at AS lastHealthAt,dispatched FROM resource_owner_progress WHERE owner_id=${auth.user.id}`,
    sql`SELECT due_at AS dueAt FROM resource_work WHERE owner_id=${auth.user.id} AND kind='index' ORDER BY due_at,id LIMIT 51`,
    sql`SELECT due_at AS dueAt FROM resource_work WHERE owner_id=${auth.user.id} AND kind='webhook' ORDER BY due_at,id LIMIT 51`,
    sql`SELECT due_at AS dueAt FROM resource_health_queue WHERE owner_id=${auth.user.id}`,
  ]);
  const backlog = (items: Record<string, any>[]) => ({ pendingAtLeast: Math.min(items.length, 50), hasMore: items.length > 50,
    dueAtLeast: Math.min(items.filter((i) => i.dueAt <= at).length, 50), nextDueAt: items[0]?.dueAt ?? null });
  return { generatedAt: at, progress: progress.results[0] ?? null, indexing: backlog(index.results), webhooks: backlog(webhook.results),
    health: health.results[0] ?? null, turnLimits: { backgroundCandidates: 50, healthOwners: 100 },
    backlogIsLowerBound: true, continuation: "Durable background cursor; each scheduled turn examines at most 50 due candidates. Paused work remains queued." };
}
export async function queueFailures(auth: RequestAuth, cursor?: string) {
  authorize(auth, "manage");
  const { key, value } = resourceCursor(cursor, [auth.user.id, "failures"]);
  const items = await rows(sql`SELECT id,kind,path,created_at AS createdAt,last_error AS lastError FROM resource_failures
    WHERE owner_id=${auth.user.id} AND (created_at,id)>(${value?.at ?? -1},${value?.after ?? ""}) ORDER BY created_at,id LIMIT 51`);
  return resourcePage(items, key, (last) => ({ after: last.id, at: last.createdAt }));
}
export async function retryFailures(auth: RequestAuth, ids: string[]) {
  authorize(auth, "manage");
  const results: Array<{ id: string; status: string }> = [];
  for (const id of ids) {
    const result = await atomicBatch([
      sql`UPDATE index_job_status SET attempts=0,last_error=NULL,next_attempt=0 WHERE entry_id=${id} AND attempts>0
        AND EXISTS(SELECT 1 FROM resource_failures f JOIN entries e ON e.id=f.id WHERE f.id=${id} AND f.kind='index' AND f.owner_id=${auth.user.id} AND e.owner_id=${auth.user.id}) RETURNING entry_id`,
      sql`UPDATE webhook_deliveries SET status='pending',attempts=0,next_attempt=${Date.now()} WHERE id=${id} AND status='failed'
        AND EXISTS(SELECT 1 FROM resource_failures f JOIN webhooks w ON w.id=webhook_deliveries.webhook_id WHERE f.id=${id} AND f.kind='webhook' AND f.owner_id=${auth.user.id} AND w.owner_id=${auth.user.id} AND w.enabled=1) RETURNING id`,
      // Source-state triggers already removed the successful retry's projection.
      // Clean only a selected diagnostic whose live source is owned and ready;
      // disabled/foreign/absent sources cannot authorize this deletion.
      sql`DELETE FROM queue_failures WHERE id=${id} AND (
        (kind='index' AND EXISTS(SELECT 1 FROM index_job_status s JOIN entries e ON e.id=s.entry_id WHERE s.entry_id=${id} AND s.attempts=0 AND e.owner_id=${auth.user.id})) OR
        (kind='webhook' AND EXISTS(SELECT 1 FROM webhook_deliveries d JOIN webhooks w ON w.id=d.webhook_id WHERE d.id=${id} AND d.status='pending' AND d.attempts=0 AND w.owner_id=${auth.user.id} AND w.enabled=1)))`,
    ]);
    results.push({ id, status: result[0].results.length || result[1].results.length ? "retried" : "unavailable" });
  }
  return { results };
}

export function requireOwned<T>(row: T, message: string): NonNullable<T> { if (row == null) throw errorResponse(404, message); return row; }
