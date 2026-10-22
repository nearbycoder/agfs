import { collectGarbage, queueObject } from "./garbage";
import { atomicBatch } from "./atomic-batch";
import { and, desc, eq, gt, sql } from "drizzle-orm";
import {
  createAgfsId,
  entries,
  getBaseName,
  getParentPath,
  normalizeAgfsPath,
  now,
  recovery,
} from "@agfs/db";
import { db } from "./db";
import { authorize, canAccess } from "./scope";
import type { RequestAuth } from "./authz";
import { folderChainStatements } from "./folder-chain";
import { errorResponse } from "./http";
import { requireResourceBindings } from "./bindings";

export async function trashEntry(
  ownerId: string,
  path: string,
  recursive = false,
  ifMatch?: string,
) {
  const group = createAgfsId("trash");
  const at = Date.now();
  const prefix = `${path}/`;
  const where = sql`(${ifMatch ?? null} IS NULL OR (kind='file' AND path=${path} AND etag=${ifMatch ?? null})) AND owner_id=${ownerId} AND (path=${path} OR substr(path,1,length(${prefix}))=${prefix})
    AND (${recursive ? 1 : 0}=1 OR NOT EXISTS (SELECT 1 FROM entries child WHERE child.owner_id=${ownerId} AND substr(child.path,1,length(${prefix}))=${prefix}))`;
  // Snapshot and removal share one D1 transaction; public shares cascade away.
  const [snapshot] = await atomicBatch([
    sql`INSERT INTO recovery(id,owner_id,group_id,reason,path,kind,size,content_type,etag,r2_key,created_at,retained_at,expires_at)
      SELECT lower(hex(randomblob(16))),owner_id,${group},'trash',path,kind,size,content_type,etag,r2_key,created_at,${at},${at + 30 * 86_400_000}
      FROM entries WHERE ${where}`,
    sql`DELETE FROM entries WHERE ${where}`,
  ]);
  // D1 already reports affected rows; returning every recovery ID needlessly
  // materializes an entire deleted subtree in the Worker.
  if (!snapshot.meta.changes)
    throw errorResponse(409, "Entry changed or folder is not empty");
}
export async function listRecovery(
  auth: RequestAuth,
  reason: "trash" | "version",
  path?: string,
  cursor?: string,
) {
  authorize(auth, "read", path ?? auth.pathPrefix ?? "/");
  const prefix = normalizeAgfsPath(path ?? auth.pathPrefix ?? "/");
  const descendants = prefix === "/" ? "/" : `${prefix}/`;
  const [before, beforeId] = cursor?.split(":") ?? [];
  const rows = await db
    .select()
    .from(recovery)
    .where(
      and(
        eq(recovery.ownerId, auth.user.id),
        eq(recovery.reason, reason),
        gt(recovery.expiresAt, now()),
        sql`(${recovery.path}=${prefix} OR substr(${recovery.path},1,length(${descendants}))=${descendants})`,
        before && beforeId
          ? sql`(${recovery.retainedAt}<${Number(before)} OR (${recovery.retainedAt}=${Number(before)} AND ${recovery.id}<${beforeId}))`
          : undefined,
      ),
    )
    .orderBy(desc(recovery.retainedAt), desc(recovery.id))
    .limit(200);
  return rows
    .filter((r) => canAccess(auth, "read", r.path))
    .map(({ r2Key, ...row }) => row);
}
export async function restoreRecovery(
  auth: RequestAuth,
  id: string,
  destination?: string,
) {
  const [record] = await db
    .select()
    .from(recovery)
    .where(
      and(
        eq(recovery.id, id),
        eq(recovery.ownerId, auth.user.id),
        gt(recovery.expiresAt, now()),
      ),
    );
  if (!record) throw errorResponse(404, "Recovery item not found");
  authorize(auth, "read", record.path);
  const target = normalizeAgfsPath(destination ?? record.path);
  if (target === "/") throw errorResponse(400, "Cannot restore to root");
  authorize(auth, "write", target);
  const rows =
    record.reason === "trash" && record.kind === "folder"
      ? await db
          .select()
          .from(recovery)
          .where(
            and(
              eq(recovery.ownerId, auth.user.id),
              eq(recovery.groupId, record.groupId),
              gt(recovery.expiresAt, now()),
            ),
          )
      : [record];
  const selected = rows.filter(
    (r) => r.path === record.path || r.path.startsWith(`${record.path}/`),
  );
  // A concurrent purge or expiry must not leave destination ancestors behind.
  if (!selected.length) throw errorResponse(404, "Recovery item not found");
  // Every restored child's parent must exist before its INSERT executes.
  selected.sort((left, right) => left.path.length - right.path.length);
  for (const row of selected) {
    authorize(auth, "read", row.path);
    authorize(auth, "write", `${target}${row.path.slice(record.path.length)}`);
  }
  const ancestors = folderChainStatements(auth.user.id, getParentPath(target) ?? "/");
  const [ancestorConflict] = ancestors;
  // Ancestors, restored entries and recovery removals must commit or roll back together.
  try {
    // Recheck expiry for every INSERT, including time spent waiting for the batch.
    const availableAt = sql`max(${Date.now()}, CAST(round((julianday('now') - 2440587.5) * 86400000) AS INTEGER))`;
    const results = await atomicBatch([
      ...ancestors,
      ...selected.flatMap((row) => {
        const path = `${target}${row.path.slice(record.path.length)}`;
        const parent = getParentPath(path) ?? "/";
        return [
          sql`INSERT INTO entries(id,owner_id,path,parent_path,name,kind,size,content_type,etag,r2_key,created_at,updated_at)
          VALUES (${createAgfsId("ent")},(SELECT owner_id FROM recovery WHERE id=${row.id} AND owner_id=${auth.user.id} AND expires_at>${availableAt}
            AND NOT EXISTS(${ancestorConflict})
            AND (${parent}='/' OR EXISTS(SELECT 1 FROM entries p WHERE p.owner_id=${auth.user.id} AND p.path=${parent} AND p.kind='folder'))),
          ${path},${parent},${getBaseName(path)},${row.kind},${row.size},${row.contentType},${row.etag},${row.r2Key},${row.createdAt.getTime()},${Date.now()}) RETURNING id`,
          db
            .delete(recovery)
            .where(
              and(eq(recovery.ownerId, auth.user.id), eq(recovery.id, row.id)),
            ),
        ];
      }),
    ]);
    if (!(results[ancestors.length] as { results?: unknown[] }).results?.length)
      throw errorResponse(409, "Recovery item changed or expired");
  } catch (error) {
    if (/UNIQUE|NOT NULL/.test(String(error)))
      throw errorResponse(
        409,
        "Destination exists. Choose a new restore path.",
      );
    throw error;
  }
  return { path: target, count: selected.length };
}
export async function purgeRecovery(auth: RequestAuth, id: string) {
  const [row] = await db
    .select()
    .from(recovery)
    .where(and(eq(recovery.id, id), eq(recovery.ownerId, auth.user.id)));
  if (!row) throw errorResponse(404, "Recovery item not found");
  authorize(auth, "delete", row.path);
  const prefix = `${row.path}/`;
  const condition =
    row.kind === "folder" && row.reason === "trash"
      ? and(
          eq(recovery.ownerId, auth.user.id),
          eq(recovery.groupId, row.groupId),
          sql`(${recovery.path}=${row.path} OR substr(${recovery.path},1,length(${prefix}))=${prefix})`,
        )
      : and(eq(recovery.id, id), eq(recovery.ownerId, auth.user.id));
  const expired = await db
    .update(recovery)
    .set({ expiresAt: new Date(0) })
    .where(condition)
    .returning();
  for (const item of expired) await removeExpiredRecovery(item);
  await collectGarbage();
  return row.path;
}
export async function removeExpiredRecovery(row: typeof recovery.$inferSelect) {
  const removal = db
    .delete(recovery)
    .where(
      and(eq(recovery.id, row.id), sql`${recovery.expiresAt}<=${Date.now()}`),
    );
  await atomicBatch(row.r2Key ? [queueObject(row.r2Key), removal] : [removal]);
}
