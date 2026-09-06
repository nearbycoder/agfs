import { storageUsageSql } from "./storage-usage";
import { sql } from "drizzle-orm";
import type { entries } from "@agfs/db";

// This predicate executes in the same SQLite statement as the write. A prior
// SELECT-based quota check alone allows simultaneous commits to exceed the plan.
export function commitUploadStatement(row: typeof entries.$inferInsert, uploadId: string, limit: number) {
  return sql`
    INSERT INTO entries (id, owner_id, parent_path, path, name, kind, size, content_type, etag, r2_key, version_id, created_at, updated_at)
    SELECT ${row.id}, ${row.ownerId}, ${row.parentPath}, ${row.path}, ${row.name}, 'file', ${row.size},
      ${row.contentType}, ${row.etag}, ${row.r2Key}, ${row.versionId}, ${row.createdAt!.getTime()}, ${row.updatedAt!.getTime()}
    WHERE EXISTS (SELECT 1 FROM uploads WHERE id = ${uploadId} AND owner_id = ${row.ownerId} AND status IN ('pending','completing') AND expires_at > ${Date.now()})
      AND NOT EXISTS (SELECT 1 FROM entries WHERE owner_id = ${row.ownerId} AND path = ${row.path} AND kind != 'file')
      AND ${storageUsageSql(row.ownerId)} + ${row.size} <= ${limit}
    ON CONFLICT(owner_id, path) DO UPDATE SET
      size = excluded.size, content_type = excluded.content_type, etag = excluded.etag,
      r2_key = excluded.r2_key, version_id = excluded.version_id, updated_at = excluded.updated_at
    RETURNING id
  `;
}
