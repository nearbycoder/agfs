import { sql } from "drizzle-orm";
import { createAgfsId, normalizeAgfsPath } from "@agfs/db";
import { first, rows } from "./platform-db";
import { atomicBatch } from "./atomic-batch";
import { authorize } from "./scope";
import { actorId } from "./workspaces";
import type { RequestAuth } from "./authz";
import { errorResponse } from "./http";
import { workspaceWriteSql } from "./workspace-write";
import { page, timeCursor } from "./cursor";
export async function snapshot(auth: RequestAuth, id: string) {
  const s = await first(
    sql`SELECT * FROM snapshots WHERE id=${id} AND owner_id=${auth.user.id} AND expires_at>${Date.now()}`,
  );
  if (!s) throw errorResponse(404, "Snapshot missing or expired");
  authorize(auth, "manage", s.path_prefix);
  return s;
}
export async function createSnapshot(
  auth: RequestAuth,
  input: { name: string; path: string; days: number },
) {
  const path = normalizeAgfsPath(input.path),
    prefix = path === "/" ? "/" : path + "/";
  authorize(auth, "manage", path);
  const id = createAgfsId("snap"),
    at = Date.now(),
    expires = at + input.days * 86400000;
  const result = await atomicBatch([
    sql`INSERT INTO snapshots SELECT ${id},${auth.user.id},${input.name},${path},${at},${expires},${actorId(auth)} WHERE (SELECT count(*) FROM snapshots WHERE owner_id=${auth.user.id})<100 AND (SELECT count(*) FROM entries WHERE owner_id=${auth.user.id} AND (path=${path} OR substr(path,1,length(${prefix}))=${prefix}))<=10000 RETURNING id`,
    sql`INSERT INTO snapshot_entries SELECT ${id},path,json_object('path',path,'parent_path',parent_path,'name',name,'kind',kind,'size',size,'content_type',content_type,'etag',etag,'r2_key',r2_key,'token_id',token_id,'created_at',created_at) FROM entries WHERE owner_id=${auth.user.id} AND (path=${path} OR substr(path,1,length(${prefix}))=${prefix}) AND EXISTS(SELECT 1 FROM snapshots WHERE id=${id})`,
    sql`INSERT INTO object_pins SELECT ${auth.user.id},${id},json_extract(entry,'$.r2_key'),${expires} FROM snapshot_entries WHERE snapshot_id=${id} AND json_extract(entry,'$.r2_key') IS NOT NULL GROUP BY json_extract(entry,'$.r2_key')`,
  ]);
  if (!result[0].results.length)
    throw errorResponse(
      409,
      "Snapshot limit reached (100 snapshots, 10,000 entries each)",
    );
  return { id, entries: result[1].meta.changes, expiresAt: expires };
}
export async function listSnapshots(auth: RequestAuth, cursor?: string) {
  authorize(auth, "manage");
  const c = timeCursor(cursor);
  const p = page(
    await rows(
      sql`SELECT * FROM snapshots WHERE owner_id=${auth.user.id} AND expires_at>${Date.now()} AND (${c?.at ?? null} IS NULL OR created_at<${c?.at ?? 0} OR (created_at=${c?.at ?? 0} AND id<${c?.id ?? ""})) ORDER BY created_at DESC,id DESC LIMIT 51`,
    ),
  );
  return { snapshots: p.results, nextCursor: p.nextCursor };
}
export async function restoreSnapshot(auth: RequestAuth, id: string) {
  const s = await snapshot(auth, id);
  authorize(auth, "write", s.path_prefix);
  authorize(auth, "delete", s.path_prefix);
  if (auth.authSource !== "session")
    throw errorResponse(403, "Restore snapshots in the browser");
  const prefix = s.path_prefix === "/" ? "/" : s.path_prefix + "/",
    at = Date.now(),
    group = createAgfsId("restore");
  // A transaction-local guard prevents partial restores after expiration or a workspace pause.
  const parent = s.path_prefix.slice(0, s.path_prefix.lastIndexOf("/")) || "/";
  const guard = sql`EXISTS(SELECT 1 FROM snapshots WHERE id=${id} AND owner_id=${auth.user.id} AND expires_at>${at}) AND ${workspaceWriteSql(auth.user.id, actorId(auth), 0)} AND (${parent}='/' OR EXISTS(SELECT 1 FROM entries WHERE owner_id=${auth.user.id} AND path=${parent} AND kind='folder'))`;
  const selected = sql`owner_id=${auth.user.id} AND (path=${s.path_prefix} OR substr(path,1,length(${prefix}))=${prefix})`;
  const results = await atomicBatch([
    sql`SELECT id FROM snapshots WHERE id=${id} AND ${guard}`,
    sql`INSERT INTO recovery(id,owner_id,group_id,reason,path,kind,size,content_type,etag,r2_key,created_at,retained_at,expires_at) SELECT lower(hex(randomblob(16))),owner_id,${group},'trash',path,kind,size,content_type,etag,r2_key,created_at,${at},${at + 30 * 86400000} FROM entries WHERE ${selected} AND ${guard}`,
    sql`DELETE FROM entries WHERE ${selected} AND ${guard}`,
    sql`INSERT INTO entries(id,owner_id,path,parent_path,name,kind,size,content_type,etag,r2_key,token_id,created_at,updated_at) SELECT lower(hex(randomblob(16))),${auth.user.id},path,json_extract(entry,'$.parent_path'),json_extract(entry,'$.name'),json_extract(entry,'$.kind'),json_extract(entry,'$.size'),json_extract(entry,'$.content_type'),json_extract(entry,'$.etag'),json_extract(entry,'$.r2_key'),json_extract(entry,'$.token_id'),json_extract(entry,'$.created_at'),${at} FROM snapshot_entries WHERE snapshot_id=${id} AND ${guard} ORDER BY length(path),path`,
  ]);
  if (!results[0].results.length)
    throw errorResponse(
      409,
      "Snapshot expired, workspace paused, or parent folder missing",
    );
  return { ok: true, restored: results[3].meta.changes };
}
export async function snapshotManifest(
  auth: RequestAuth,
  id: string,
  cursor?: string,
) {
  await snapshot(auth, id);
  const entries = await rows(
    sql`SELECT path,entry FROM snapshot_entries WHERE snapshot_id=${id} AND path>${cursor ?? ""} ORDER BY path LIMIT 201`,
  );
  return {
    entries: entries.slice(0, 200).map((r) => JSON.parse(r.entry)),
    nextCursor: entries.length > 200 ? entries[199].path : null,
  };
}
export async function deleteSnapshot(auth: RequestAuth, id: string) {
  await snapshot(auth, id);
  await atomicBatch([
    sql`INSERT OR IGNORE INTO object_gc SELECT object_key,${Date.now()} FROM object_pins WHERE reference_id=${id}`,
    sql`DELETE FROM object_pins WHERE reference_id=${id}`,
    sql`DELETE FROM snapshots WHERE id=${id} AND owner_id=${auth.user.id}`,
  ]);
  return { ok: true };
}
