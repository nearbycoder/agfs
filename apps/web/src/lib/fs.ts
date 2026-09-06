import { and, asc, eq, gt, isNotNull, isNull, or, sql } from "drizzle-orm";
import type { FsEntry, FsTreeNode, ShareLinkRecord } from "@agfs/contracts";
import {
  buildObjectKey,
  createAgfsId,
  createShareTokenValue,
  createUploadTokenValue,
  entries,
  getBaseName,
  getParentPath,
  hashSecret,
  normalizeAgfsPath,
  now,
  parseTtl,
  secretPrefix,
  shareLinkViews,
  shareLinks,
  uploads,
} from "@agfs/db";
import { db } from "./db";
import { commitUploadStatement } from "./upload-commit";
import { requireResourceBindings, requireStringBindings } from "./bindings";
import { getStorageWriteDecisionForUser } from "./account";
import { errorResponse } from "./http";
import { createUploadIntentUrl } from "./r2";

// SQLite LIKE is case-insensitive and treats %/_ as wildcards. Paths are literal.
export function descendantPathCondition(path: string) {
  const prefix = `${path}/`;
  return sql`substr(${entries.path}, 1, length(${prefix})) = ${prefix}`;
}

function mapEntry(row: typeof entries.$inferSelect): FsEntry {
  return {
    id: row.id,
    ownerId: row.ownerId,
    parentPath: row.parentPath,
    path: row.path,
    name: row.name,
    kind: row.kind,
    size: row.size ?? null,
    contentType: row.contentType ?? null,
    etag: row.etag ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function sortEntries(left: { path: string }, right: { path: string }) {
  return left.path.localeCompare(right.path);
}

export async function getEntryByPath(ownerId: string, path: string) {
  const normalized = normalizeAgfsPath(path);
  const [row] = await db
    .select()
    .from(entries)
    .where(and(eq(entries.ownerId, ownerId), eq(entries.path, normalized)));
  return row ?? null;
}

async function ensureFolderChain(ownerId: string, path: string) {
  const normalized = normalizeAgfsPath(path);
  if (normalized === "/") {
    return;
  }

  const parts = normalized.split("/").filter(Boolean);
  let current = "";
  for (const part of parts) {
    current += `/${part}`;
    const existing = await getEntryByPath(ownerId, current);
    if (existing) {
      if (existing.kind !== "folder") {
        throw errorResponse(400, `Cannot create folder path through file ${existing.path}`);
      }
      continue;
    }

    await db.insert(entries).values({
      id: createAgfsId("ent"),
      ownerId,
      parentPath: getParentPath(current),
      path: current,
      name: getBaseName(current),
      kind: "folder",
      createdAt: now(),
      updatedAt: now(),
    });
  }
}

export async function listEntries(ownerId: string, path: string) {
  const normalized = normalizeAgfsPath(path);
  if (normalized !== "/") {
    const existing = await getEntryByPath(ownerId, normalized);
    if (!existing) {
      throw errorResponse(400, "Folder not found");
    }
    if (existing.kind !== "folder") {
      throw errorResponse(400, "Path is not a folder");
    }
  }

  const rows = await db
    .select()
    .from(entries)
    .where(and(eq(entries.ownerId, ownerId), eq(entries.parentPath, normalized)))
    .orderBy(asc(entries.kind), asc(entries.name));

  return rows.map(mapEntry);
}

export async function treeEntries(ownerId: string, path: string): Promise<FsTreeNode[]> {
  const normalized = normalizeAgfsPath(path);
  const rows =
    normalized === "/"
      ? await db.select().from(entries).where(eq(entries.ownerId, ownerId)).orderBy(asc(entries.path))
      : await db
          .select()
          .from(entries)
          .where(
            and(
              eq(entries.ownerId, ownerId),
              or(eq(entries.path, normalized), descendantPathCondition(normalized)),
            ),
          )
          .orderBy(asc(entries.path));

  const source = normalized === "/" ? rows : rows.filter((row) => row.path !== normalized);
  const nodeMap = new Map<string, FsTreeNode>();

  for (const row of source) {
    nodeMap.set(row.path, {
      id: row.id,
      path: row.path,
      name: row.name,
      kind: row.kind,
      size: row.size ?? null,
      children: row.kind === "folder" ? [] : undefined,
    });
  }

  const roots: FsTreeNode[] = [];
  for (const row of source.sort(sortEntries)) {
    const node = nodeMap.get(row.path)!;
    const parentPath = row.parentPath;
    const isRootChild = normalized === "/" ? parentPath === "/" : parentPath === normalized;
    if (isRootChild) {
      roots.push(node);
      continue;
    }

    const parent = parentPath ? nodeMap.get(parentPath) : null;
    if (parent?.children) {
      parent.children.push(node);
    }
  }

  return roots;
}

export async function mkdir(ownerId: string, path: string) {
  await ensureFolderChain(ownerId, normalizeAgfsPath(path));
}

export async function createUploadIntent(user: { id: string; email: string }, input: {
  path: string;
  contentType: string;
  size: number;
}) {
  const ownerId = user.id;
  const normalized = normalizeAgfsPath(input.path);
  if (normalized === "/") throw errorResponse(400, "Cannot upload to root");
  const parentPath = getParentPath(normalized) ?? "/";
  await ensureFolderChain(ownerId, parentPath);

  const existing = await getEntryByPath(ownerId, normalized);
  if (existing && existing.kind !== "file") {
    throw errorResponse(400, "Cannot overwrite a folder");
  }

  const storageDecision = await getStorageWriteDecisionForUser({
    user,
    existingFileSizeBytes: existing?.size ?? 0,
    incomingSizeBytes: input.size,
  });
  if (!storageDecision.allowed) {
    throw errorResponse(403, storageDecision.message);
  }

  const entryId = existing?.id ?? createAgfsId("ent");
  const versionId = createAgfsId("ver");
  const uploadId = createAgfsId("upl");
  const uploadToken = createUploadTokenValue();
  const expiresAt = new Date(Date.now() + 15 * 60_000);
  const objectKey = buildObjectKey(ownerId, entryId, versionId);

  // Remove abandoned objects for this owner before reserving more upload space.
  const stale = await db.select().from(uploads).where(and(eq(uploads.ownerId, ownerId), eq(uploads.status, "pending"), sql`${uploads.expiresAt} <= ${Date.now()}`)).limit(32);
  const { FILES_BUCKET } = requireResourceBindings("FILES_BUCKET");
  for (const abandoned of stale) {
    await FILES_BUCKET.delete(abandoned.objectKey);
    await db.update(uploads).set({ status: "expired" }).where(eq(uploads.id, abandoned.id));
  }
  const reservation = await db.run(sql`
    INSERT INTO uploads (id, owner_id, path, content_type, size, object_key, upload_token_hash, status, expires_at)
    SELECT ${uploadId}, ${ownerId}, ${normalized}, ${input.contentType}, ${input.size}, ${objectKey}, ${hashSecret(uploadToken)}, 'pending', ${expiresAt.getTime()}
    WHERE (SELECT count(*) FROM uploads WHERE owner_id = ${ownerId} AND status = 'pending') < 32
      AND (SELECT coalesce(sum(size), 0) FROM uploads WHERE owner_id = ${ownerId} AND status = 'pending')
        + (SELECT coalesce(sum(size), 0) FROM entries WHERE owner_id = ${ownerId} AND kind = 'file' AND path != ${normalized})
        + ${input.size} <= ${Math.max(storageDecision.storageLimitBytes, storageDecision.currentUsageBytes)}
    RETURNING id
  `);
  if (!reservation.results.length) throw errorResponse(409, "Pending uploads exceed available storage; finish uploads or retry after they expire");

  return createUploadIntentUrl({
    uploadId,
    uploadToken,
    objectKey,
    contentType: input.contentType,
    expiresAt,
  });
}

export async function commitUpload(user: { id: string; email: string }, uploadId: string, etag: string) {
  const ownerId = user.id;
  const [upload] = await db
    .select()
    .from(uploads)
    .where(and(eq(uploads.id, uploadId), eq(uploads.ownerId, ownerId)));

  if (!upload) {
    throw errorResponse(400, "Upload not found");
  }
  if (upload.status !== "pending") {
    throw errorResponse(409, "Upload is no longer pending");
  }
  if (upload.expiresAt.getTime() <= Date.now()) {
    throw errorResponse(400, "Upload expired");
  }

  const { FILES_BUCKET } = requireResourceBindings("FILES_BUCKET");
  const object = await FILES_BUCKET.head(upload.objectKey);
  if (!object) {
    throw errorResponse(400, "Uploaded object not found in R2");
  }

  const existing = await getEntryByPath(ownerId, upload.path);
  if (existing && existing.kind !== "file") throw errorResponse(409, "Cannot overwrite a folder");
  await ensureFolderChain(ownerId, getParentPath(upload.path) ?? "/");
  const createdAt = existing?.createdAt ?? now();
  const nextEntryId = existing?.id ?? upload.objectKey.split("/")[3] ?? createAgfsId("ent");
  const objectSize = object.size;

  if (objectSize == null || objectSize !== upload.size) {
    await FILES_BUCKET.delete(upload.objectKey);
    throw errorResponse(400, "Uploaded object size did not match the approved upload intent");
  }

  const storageDecision = await getStorageWriteDecisionForUser({
    user,
    existingFileSizeBytes: existing?.size ?? 0,
    incomingSizeBytes: objectSize,
  });
  if (!storageDecision.allowed) {
    await FILES_BUCKET.delete(upload.objectKey);
    await db
      .update(uploads)
      .set({ status: "expired" })
      .where(eq(uploads.id, upload.id));
    throw errorResponse(403, storageDecision.message);
  }

  const row = {
    id: nextEntryId,
    ownerId,
    parentPath: getParentPath(upload.path),
    path: upload.path,
    name: getBaseName(upload.path),
    kind: "file" as const,
    size: objectSize,
    contentType: upload.contentType,
    etag: object.etag ?? etag,
    r2Key: upload.objectKey,
    versionId: upload.objectKey.split("/").at(-1) ?? null,
    createdAt,
    updatedAt: now(),
  };

  const [result] = await db.batch([
    db.run(commitUploadStatement(row, uploadId, storageDecision.storageLimitBytes)),
    db.update(uploads).set({ status: "committed", committedAt: now() }).where(and(
      eq(uploads.id, upload.id), eq(uploads.status, "pending"),
      sql`exists (select 1 from entries where owner_id = ${ownerId} and r2_key = ${upload.objectKey})`,
    )),
  ]);
  if (!result.results.length) {
    throw errorResponse(409, "Upload could not be committed: quota or destination changed");
  }
  const savedId = String(result.results[0].id);
  row.id = savedId;
  if (existing?.r2Key && existing.r2Key !== upload.objectKey) {
    await FILES_BUCKET.delete(existing.r2Key);
  }

  return mapEntry(
    existing
      ? { ...existing, ...row }
      : {
          ...row,
        },
  );
}

export async function moveEntry(ownerId: string, from: string, to: string) {
  const sourcePath = normalizeAgfsPath(from);
  const destinationPath = normalizeAgfsPath(to);

  if (sourcePath === "/" || destinationPath === "/") {
    throw errorResponse(400, "Root cannot be moved");
  }
  if (destinationPath === sourcePath || destinationPath.startsWith(`${sourcePath}/`)) {
    throw errorResponse(400, "Destination cannot be inside the source path");
  }

  const source = await getEntryByPath(ownerId, sourcePath);
  if (!source) {
    throw errorResponse(400, "Source entry not found");
  }

  const existing = await getEntryByPath(ownerId, destinationPath);
  if (existing) {
    throw errorResponse(400, "Destination already exists");
  }

  await ensureFolderChain(ownerId, getParentPath(destinationPath) ?? "/");

  const conflicts = await db
    .select({ path: entries.path })
    .from(entries)
    .where(
      and(
        eq(entries.ownerId, ownerId),
        or(eq(entries.path, destinationPath), descendantPathCondition(destinationPath)),
      ),
    );
  if (conflicts.length > 0) {
    throw errorResponse(400, "Destination subtree already exists");
  }

  const affected =
    source.kind === "folder"
      ? await db
          .select()
          .from(entries)
          .where(
            and(
              eq(entries.ownerId, ownerId),
              or(eq(entries.path, sourcePath), descendantPathCondition(sourcePath)),
            ),
          )
      : [source];

  for (const row of affected.sort((left, right) => left.path.length - right.path.length)) {
    const nextPath = row.path === sourcePath ? destinationPath : row.path.replace(`${sourcePath}/`, `${destinationPath}/`);
    await db
      .update(entries)
      .set({
        path: nextPath,
        parentPath: getParentPath(nextPath),
        name: getBaseName(nextPath),
        updatedAt: now(),
      })
      .where(and(eq(entries.ownerId, ownerId), eq(entries.id, row.id)));
  }
}

export async function deleteEntry(ownerId: string, path: string, recursive = false) {
  const normalized = normalizeAgfsPath(path);
  const entry = await getEntryByPath(ownerId, normalized);
  if (!entry) {
    throw errorResponse(400, "Entry not found");
  }

  const { FILES_BUCKET } = requireResourceBindings("FILES_BUCKET");
  const affected =
    entry.kind === "folder"
      ? await db
          .select()
          .from(entries)
          .where(
            and(
              eq(entries.ownerId, ownerId),
              or(eq(entries.path, normalized), descendantPathCondition(normalized)),
            ),
          )
      : [entry];

  if (entry.kind === "folder" && !recursive && affected.length > 1) {
    throw errorResponse(400, "Folder is not empty");
  }

  for (const row of affected.filter((candidate) => candidate.r2Key)) {
    await FILES_BUCKET.delete(row.r2Key!);
  }

  await db
    .delete(entries)
    .where(
      and(
        eq(entries.ownerId, ownerId),
        or(eq(entries.path, normalized), descendantPathCondition(normalized)),
      ),
    );
}

export async function listShares(ownerId: string): Promise<ShareLinkRecord[]> {
  const rows = await db
    .select({
      id: shareLinks.id,
      createdAt: shareLinks.createdAt,
      expiresAt: shareLinks.expiresAt,
      revokedAt: shareLinks.revokedAt,
      path: entries.path,
    })
    .from(shareLinks)
    .innerJoin(entries, eq(entries.id, shareLinks.entryId))
    .where(eq(shareLinks.ownerId, ownerId));

  const bindings = requireStringBindings("APP_URL");
  return rows.map((row) => ({
    id: row.id,
    path: row.path,
    url: `${bindings.APP_URL}/s/${row.id}`,
    createdAt: row.createdAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
    revokedAt: row.revokedAt?.toISOString() ?? null,
  }));
}

export async function createShare(ownerId: string, path: string, ttl: string): Promise<ShareLinkRecord> {
  const entry = await getEntryByPath(ownerId, path);
  if (!entry || entry.kind !== "file") {
    throw errorResponse(400, "File not found");
  }

  const token = createShareTokenValue();
  const record = {
    id: token,
    ownerId,
    entryId: entry.id,
    tokenHash: hashSecret(token),
    prefix: secretPrefix(token),
    createdAt: now(),
    expiresAt: new Date(Date.now() + parseTtl(ttl)),
  };

  await db.insert(shareLinks).values(record);

  const bindings = requireStringBindings("APP_URL");
  return {
    id: record.id,
    path: entry.path,
    url: `${bindings.APP_URL}/s/${token}`,
    createdAt: record.createdAt.toISOString(),
    expiresAt: record.expiresAt.toISOString(),
    revokedAt: null,
  };
}

export async function revokeShare(ownerId: string, shareId: string) {
  await db
    .update(shareLinks)
    .set({ revokedAt: now() })
    .where(and(eq(shareLinks.ownerId, ownerId), eq(shareLinks.id, shareId)));
}

export async function resolveShare(token: string) {
  const nowAt = now();
  const [share] = await db
    .select({
      id: shareLinks.id,
      ownerId: shareLinks.ownerId,
      entryId: shareLinks.entryId,
      expiresAt: shareLinks.expiresAt,
      revokedAt: shareLinks.revokedAt,
      path: entries.path,
      contentType: entries.contentType,
      r2Key: entries.r2Key,
      name: entries.name,
    })
    .from(shareLinks)
    .innerJoin(entries, eq(entries.id, shareLinks.entryId))
    .where(
      and(
        eq(shareLinks.id, token),
        isNull(shareLinks.revokedAt),
        gt(shareLinks.expiresAt, nowAt),
        isNotNull(entries.r2Key),
      ),
    );

  if (!share) {
    return null;
  }

  await db.insert(shareLinkViews).values({
    id: createAgfsId("view"),
    shareId: share.id,
    ipAddress: null,
    userAgent: null,
  });

  return share;
}
