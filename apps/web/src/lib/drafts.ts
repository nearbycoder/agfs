import { page, timeCursor } from "./cursor";
import { workspaceWriteSql } from "./workspace-write";
import { sql } from "drizzle-orm";
import {
  createAgfsId,
  normalizeAgfsPath,
  getParentPath,
  getBaseName,
  now,
} from "@agfs/db";
import { first, rows } from "./platform-db";
import { atomicBatch } from "./atomic-batch";
import type { RequestAuth } from "./authz";
import { actorId } from "./workspaces";
import { authorize } from "./scope";
import { errorResponse } from "./http";
import { requireResourceBindings } from "./bindings";
import { getEntryByPath, createUploadIntent } from "./fs";
import { storageUsageSql } from "./storage-usage";
import { getStorageWriteDecisionForUser } from "./account";
export async function draft(auth: RequestAuth, id: string) {
  const item = await first(
    sql`SELECT * FROM draft_sets WHERE id=${id} AND owner_id=${auth.user.id}`,
  );
  if (!item) throw errorResponse(404, "Draft not found");
  authorize(auth, "read", item.path_prefix);
  return item;
}
export async function createDraft(
  auth: RequestAuth,
  name: string,
  path: string,
) {
  path = normalizeAgfsPath(path);
  authorize(auth, "write", path);
  const id = createAgfsId("draft");
  await rows(
    sql`INSERT INTO draft_sets(id,owner_id,actor_id,name,path_prefix,created_at) VALUES (${id},${auth.user.id},${actorId(auth)},${name},${path},${Date.now()})`,
  );
  return { id, name, path, status: "open" };
}
export async function listDrafts(auth: RequestAuth, cursor?: string) {
  const prefix = auth.pathPrefix ?? "/";
  authorize(auth, "read", prefix);
  const c = timeCursor(cursor);
  const result = page(
    await rows(sql`SELECT id,name,path_prefix,status,created_at FROM draft_sets WHERE owner_id=${auth.user.id}
    AND (${prefix}='/' OR path_prefix=${prefix} OR substr(path_prefix,1,length(${prefix + "/"}))=${prefix + "/"}) AND (${c?.at ?? null} IS NULL OR created_at<${c?.at ?? 0} OR (created_at=${c?.at ?? 0} AND id<${c?.id ?? ""})) ORDER BY created_at DESC,id DESC LIMIT 51`),
  );
  return { drafts: result.results, nextCursor: result.nextCursor };
}
export async function draftDetail(auth: RequestAuth, id: string) {
  const item = await draft(auth, id);
  const changes = await rows(
    sql`SELECT * FROM draft_changes WHERE draft_id=${id} ORDER BY path`,
  );
  for (const c of changes) authorize(auth, "read", c.path);
  const comments = await rows(
    sql`SELECT c.id,c.body,c.path,c.line,c.created_at,u.name AS author FROM draft_comments c JOIN user u ON u.id=c.actor_id WHERE c.draft_id=${id} ORDER BY c.created_at LIMIT 200`,
  );
  return { ...item, changes, comments } as Record<string, any> & {
    changes: Record<string, any>[];
  };
}
export async function changeDraft(
  auth: RequestAuth,
  id: string,
  input: {
    path: string;
    operation: "write" | "delete";
    content?: string;
    contentType?: string;
  },
) {
  const item = await draft(auth, id),
    path = normalizeAgfsPath(input.path);
  authorize(auth, "write", path);
  if (!(
    path === item.path_prefix ||
    path.startsWith(item.path_prefix === "/" ? "/" : item.path_prefix + "/")
  ))
    throw errorResponse(403, "Change is outside the draft folder");
  if (item.actor_id !== actorId(auth)) authorize(auth, "manage");
  if (!["open", "changes_requested"].includes(item.status))
    throw errorResponse(409, "Reviewed drafts cannot be edited");
  if (input.operation === "delete") authorize(auth, "delete", path);
  if (path === "/") throw errorResponse(400, "Root cannot be a draft file");
  const existing = await getEntryByPath(auth.user.id, path);
  if (existing?.kind === "folder")
    throw errorResponse(400, "Drafts support individual text files");
  if (existing && (existing.size ?? 0) > 65536)
    throw errorResponse(400, "Draft editing supports files up to 64 KiB");
  let base = "";
  if (existing?.r2Key) {
    const object = await requireResourceBindings(
      "FILES_BUCKET",
    ).FILES_BUCKET.get(existing.r2Key);
    if (!object) throw errorResponse(409, "File changed");
    base = await object.text();
  }
  const changed =
    await rows(sql`INSERT INTO draft_changes(draft_id,path,operation,base_etag,base_exists,content,content_type,base_content)
    SELECT ${id},${path},${input.operation},${existing?.etag ?? null},${existing ? 1 : 0},${input.content ?? null},${input.contentType ?? "text/plain"},${base}
    WHERE EXISTS(SELECT 1 FROM draft_sets WHERE id=${id} AND status IN ('open','changes_requested'))
      AND ((SELECT count(*) FROM draft_changes WHERE draft_id=${id})<30 OR EXISTS(SELECT 1 FROM draft_changes WHERE draft_id=${id} AND path=${path}))
    ON CONFLICT(draft_id,path) DO UPDATE SET operation=excluded.operation,content=excluded.content,content_type=excluded.content_type
    RETURNING path`);
  if (!changed.length)
    throw errorResponse(409, "Draft changed or has reached its 30-file limit");
  return { ok: true };
}
export async function requireDraftReviewer(
  auth: RequestAuth,
  item: Record<string, any>,
) {
  if (auth.authSource !== "session")
    throw errorResponse(403, "A person must review drafts in the browser");
  const independent = auth.workspaceId
    ? !!(
        await first(
          sql`SELECT independent_review FROM workspaces WHERE id=${auth.workspaceId}`,
        )
      )?.independent_review
    : false;
  if (independent && auth.workspaceRole === "editor")
    authorize(auth, "write", item.path_prefix);
  else authorize(auth, "manage");
  return independent;
}
export async function reviewDraft(
  auth: RequestAuth,
  id: string,
  accept: boolean,
) {
  const item = await draft(auth, id);
  const independent = await requireDraftReviewer(auth, item);
  if (accept && independent && item.actor_id === actorId(auth))
    throw errorResponse(403, "Another person must approve this draft");
  if (auth.authSource !== "session")
    throw errorResponse(403, "A person must review drafts in the browser");
  const reviewed =
    await rows(sql`UPDATE draft_sets SET status=${accept ? "approved" : "rejected"},reviewed_by=${actorId(auth)},reviewed_at=${Date.now()}
    WHERE id=${id} AND status='open' AND (${accept ? 1 : 0}=0 OR actor_id!=${actorId(auth)} OR NOT EXISTS(SELECT 1 FROM workspaces WHERE id=${auth.workspaceId ?? ""} AND independent_review=1)) AND EXISTS(SELECT 1 FROM draft_changes WHERE draft_id=${id}) RETURNING id`);
  if (!reviewed.length)
    throw errorResponse(409, "Draft is empty or already reviewed");
  return { ok: true };
}
export async function applyDraft(auth: RequestAuth, id: string) {
  const item = await draftDetail(auth, id);
  if (item.status !== "approved")
    throw errorResponse(409, "Draft requires approval");
  const changes = item.changes;
  if (changes.length > 30)
    throw errorResponse(409, "Apply supports at most 30 files per draft");
  const prepared: {
    change: Record<string, any>;
    uploadId: string;
    key: string;
    size: number;
    etag: string;
  }[] = [];
  for (const c of changes) {
    authorize(auth, "write", c.path);
    if (c.operation === "delete") authorize(auth, "delete", c.path);
    const parent = getParentPath(c.path) ?? "/";
    if (
      parent !== "/" &&
      (await getEntryByPath(auth.user.id, parent))?.kind !== "folder"
    )
      throw errorResponse(
        409,
        "Create the destination folder before applying the draft",
      );
    const live = await getEntryByPath(auth.user.id, c.path);
    if (!!live !== !!c.base_exists || (live?.etag ?? null) !== c.base_etag)
      throw errorResponse(409, `Conflict at ${c.path}; create a new draft`);
  }
  for (const c of changes.filter((c) => c.operation === "write")) {
    const bytes = new TextEncoder().encode(c.content ?? "");
    const intent = await createUploadIntent(auth.user, {
      path: c.path,
      contentType: c.content_type,
      size: bytes.length,
      prepareParents: false,
      ifMatch: c.base_exists ? c.base_etag : null,
    });
    const object = await requireResourceBindings(
      "FILES_BUCKET",
    ).FILES_BUCKET.put(intent.objectKey, bytes, {
      onlyIf: { etagDoesNotMatch: "*" },
      httpMetadata: { contentType: c.content_type },
    });
    if (!object) throw errorResponse(409, "Draft upload changed; retry");
    prepared.push({
      change: c,
      uploadId: intent.uploadId,
      key: intent.objectKey,
      size: bytes.length,
      etag: object.etag ?? "uploaded",
    });
  }
  const incoming = prepared.reduce((n, p) => n + p.size, 0),
    nonce = createAgfsId("apply"),
    at = Date.now();
  const decision = await getStorageWriteDecisionForUser({
    user: auth.user,
    incomingSizeBytes: incoming,
  });
  if (!decision.allowed) throw errorResponse(403, decision.message);
  const guard = sql`EXISTS(SELECT 1 FROM draft_sets WHERE id=${id} AND apply_token=${nonce} AND status='applying')`;
  const ready = prepared.map(
    (p) =>
      sql`EXISTS(SELECT 1 FROM uploads WHERE id=${p.uploadId} AND status='pending' AND expires_at>${at})`,
  );
  const parents = changes
    .filter((c) => c.operation === "write")
    .map(
      (c) =>
        sql`(${getParentPath(c.path)}='/' OR EXISTS(SELECT 1 FROM entries WHERE owner_id=${auth.user.id} AND path=${getParentPath(c.path)} AND kind='folder'))`,
    );
  const statements = [
    sql`UPDATE draft_sets SET status='applying',apply_token=${nonce} WHERE id=${id} AND status='approved'
    AND NOT EXISTS(SELECT 1 FROM draft_changes c LEFT JOIN entries e ON e.owner_id=${auth.user.id} AND e.path=c.path WHERE c.draft_id=${id}
      AND ((c.base_exists=0 AND e.id IS NOT NULL) OR (c.base_exists=1 AND (e.id IS NULL OR e.etag IS NOT c.base_etag OR e.kind!='file'))))
    AND (${ready.length ? sql.join(ready, sql` AND `) : sql`1`}) AND (${parents.length ? sql.join(parents, sql` AND `) : sql`1`})
    AND ${workspaceWriteSql(auth.user.id, actorId(auth), incoming)}
    AND (${auth.tokenId ?? null} IS NULL OR EXISTS(SELECT 1 FROM api_tokens WHERE id=${auth.tokenId ?? null} AND paused=0 AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at>${at}) AND (storage_limit IS NULL OR (SELECT coalesce(sum(size),0) FROM object_usage WHERE token_id=${auth.tokenId ?? null})+${incoming}<=storage_limit)))
    AND ${storageUsageSql(auth.user.id)}+${incoming}<=${decision.storageLimitBytes} RETURNING id`,
  ];
  for (const c of changes) {
    if (c.operation === "delete") {
      statements.push(
        sql`INSERT INTO recovery(id,owner_id,group_id,reason,path,kind,size,content_type,etag,r2_key,created_at,retained_at,expires_at)
        SELECT ${createAgfsId("rec")},owner_id,${id},'trash',path,kind,size,content_type,etag,r2_key,created_at,${at},${at + 30 * 86400000}
        FROM entries WHERE owner_id=${auth.user.id} AND path=${c.path} AND ${guard}`,
        sql`DELETE FROM entries WHERE owner_id=${auth.user.id} AND path=${c.path} AND ${guard}`,
      );
    } else {
      const p = prepared.find((p) => p.change.path === c.path)!;
      statements.push(
        sql`INSERT INTO entries(id,owner_id,path,parent_path,name,kind,size,content_type,etag,r2_key,version_id,token_id,created_at,updated_at)
        SELECT ${createAgfsId("ent")},${auth.user.id},${c.path},${getParentPath(c.path)},${getBaseName(c.path)},'file',${p.size},${c.content_type},${p.etag},${p.key},${nonce},${auth.tokenId ?? null},${at},${at} WHERE ${guard}
        ON CONFLICT(owner_id,path) DO UPDATE SET size=excluded.size,content_type=excluded.content_type,etag=excluded.etag,r2_key=excluded.r2_key,version_id=excluded.version_id,token_id=excluded.token_id,updated_at=excluded.updated_at`,
        sql`UPDATE uploads SET status='committed',committed_at=${at} WHERE id=${p.uploadId} AND ${guard}`,
        sql`INSERT INTO object_usage(object_key,owner_id,token_id,size) SELECT ${p.key},${auth.user.id},${auth.tokenId ?? null},${p.size} WHERE ${guard}`,
      );
    }
  }
  statements.push(
    sql`UPDATE draft_sets SET status='applied',applied_at=${at} WHERE id=${id} AND apply_token=${nonce} AND status='applying'`,
  );
  const result = await atomicBatch(statements);
  if (!result[0].results.length)
    throw errorResponse(
      409,
      "Draft conflicts with current files or storage quota; nothing was applied",
    );
  return { ok: true, files: changes.length };
}
