import {workspaceWriteSql} from "./workspace-write";
import { storageUsageSql } from "./storage-usage";
import { sql } from "drizzle-orm";
import type { entries } from "@agfs/db";

// This predicate executes in the same SQLite statement as the write. A prior
// SELECT-based quota check alone allows simultaneous commits to exceed the plan.
export function commitUploadStatement(
  row: typeof entries.$inferInsert,
  uploadId: string,
  limit: number,
  actorId = row.ownerId,
) {
  return sql`
    INSERT INTO entries (id, owner_id, parent_path, path, name, kind, size, content_type, etag, r2_key, version_id, created_at, updated_at,token_id)
    SELECT ${row.id}, ${row.ownerId}, ${row.parentPath}, ${row.path}, ${row.name}, 'file', ${row.size},
      ${row.contentType}, ${row.etag}, ${row.r2Key}, ${row.versionId}, ${row.createdAt!.getTime()}, ${row.updatedAt!.getTime()},${row.tokenId ?? null}
    WHERE EXISTS (SELECT 1 FROM uploads WHERE id = ${uploadId} AND owner_id = ${row.ownerId} AND status IN ('pending','completing') AND expires_at > ${Date.now()}
      AND (condition_mode='any' OR (condition_mode='absent' AND NOT EXISTS(SELECT 1 FROM entries e WHERE e.owner_id=${row.ownerId} AND e.path=${row.path}))
        OR (condition_mode='match' AND expected_etag=(SELECT etag FROM entries e WHERE e.owner_id=${row.ownerId} AND e.path=${row.path}))))
      AND NOT EXISTS (SELECT 1 FROM entries WHERE owner_id = ${row.ownerId} AND path = ${row.path} AND kind != 'file')
      AND ${workspaceWriteSql(row.ownerId,actorId,row.size??0)}
      AND ${storageUsageSql(row.ownerId)} + ${row.size} <= ${limit}
      AND (${row.tokenId ?? null} IS NULL OR EXISTS(SELECT 1 FROM api_tokens t WHERE t.id=${row.tokenId ?? null} AND t.paused=0 AND t.revoked_at IS NULL AND (t.expires_at IS NULL OR t.expires_at>${Date.now()})
        AND (t.storage_limit IS NULL OR (SELECT coalesce(sum(size),0) FROM object_usage WHERE token_id=t.id)+${row.size}<=t.storage_limit)))
    ON CONFLICT(owner_id, path) DO UPDATE SET
      token_id=excluded.token_id, size = excluded.size, content_type = excluded.content_type, etag = excluded.etag,
      r2_key = excluded.r2_key, version_id = excluded.version_id, updated_at = excluded.updated_at
    RETURNING id
  `;
}
