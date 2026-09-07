import { and, asc, eq, sql } from "drizzle-orm";
import { uploads, uploadParts, now, normalizeAgfsPath } from "@agfs/db";
import { db } from "./db";
import type { RequestAuth } from "./authz";
import { authorize } from "./scope";
import { errorResponse } from "./http";
import { requireResourceBindings } from "./bindings";
import { commitUpload, createUploadIntent } from "./fs";

export const PART_SIZE = 8 * 1024 * 1024;
export const MAX_UPLOAD_SIZE = 20_000_000_000;
export async function authorizeUpload(auth: RequestAuth, id: string) {
  const [row] = await db
    .select()
    .from(uploads)
    .where(and(eq(uploads.id, id), eq(uploads.ownerId, auth.user.id)));
  if (!row) throw errorResponse(404, "Upload not found");
  authorize(auth, "write", row.path);
  return row;
}
function active(row: typeof uploads.$inferSelect) {
  if (
    row.expiresAt.getTime() <= Date.now() ||
    !["pending", "completing"].includes(row.status)
  )
    throw errorResponse(409, "Upload expired or finished");
  if (!row.multipartId) throw errorResponse(409, "Not a resumable upload");
}
export async function startMultipart(
  auth: RequestAuth,
  input: {
    path: string;
    contentType: string;
    size: number;
    fingerprint: string;
    ifMatch?: string | null;
  },
) {
  input = { ...input, path: normalizeAgfsPath(input.path) };
  authorize(auth, "write", input.path);
  if (
    !Number.isSafeInteger(input.size) ||
    input.size <= 0 ||
    input.size > MAX_UPLOAD_SIZE
  )
    throw errorResponse(
      400,
      "Resumable files must be between 1 byte and 20 GB, within your storage quota",
    );
  const [previous] = await db
    .select()
    .from(uploads)
    .where(
      and(
        eq(uploads.ownerId, auth.user.id),
        eq(uploads.path, input.path),
        eq(uploads.fingerprint, input.fingerprint),
        eq(uploads.size, input.size),
        eq(uploads.contentType, input.contentType),
        eq(
          uploads.conditionMode,
          input.ifMatch === undefined
            ? "any"
            : input.ifMatch === null
              ? "absent"
              : "match",
        ),
        sql`${uploads.expectedEtag} IS ${input.ifMatch ?? null}`,
        sql`${uploads.status} in ('pending','completing')`,
        sql`${uploads.expiresAt}>${Date.now()}`,
        sql`${uploads.multipartId} is not null`,
      ),
    )
    .limit(1);
  if (previous) return multipartStatus(auth, previous.id);
  const intent = await createUploadIntent(auth.user, {
    ...input,
    resumable: true,
  });
  const { FILES_BUCKET } = requireResourceBindings("FILES_BUCKET");
  const multipart = await FILES_BUCKET.createMultipartUpload(intent.objectKey, {
    httpMetadata: { contentType: input.contentType },
  });
  try {
    await db
      .update(uploads)
      .set({ multipartId: multipart.uploadId, fingerprint: input.fingerprint })
      .where(eq(uploads.id, intent.uploadId));
  } catch (error) {
    await multipart.abort();
    throw error;
  }
  return multipartStatus(auth, intent.uploadId);
}
export async function multipartStatus(auth: RequestAuth, id: string) {
  const row = await authorizeUpload(auth, id);
  active(row);
  const parts = await db
    .select()
    .from(uploadParts)
    .where(eq(uploadParts.uploadId, id))
    .orderBy(asc(uploadParts.partNumber));
  return {
    uploadId: id,
    path: row.path,
    size: row.size,
    partSize: PART_SIZE,
    status: row.status,
    expiresAt: row.expiresAt.toISOString(),
    parts,
  };
}
export async function putPart(
  auth: RequestAuth,
  id: string,
  partNumber: number,
  request: Request,
) {
  const row = await authorizeUpload(auth, id);
  active(row);
  if (row.status !== "pending")
    throw errorResponse(409, "Upload is being completed");
  const count = Math.ceil(row.size / PART_SIZE);
  if (!Number.isInteger(partNumber) || partNumber < 1 || partNumber > count)
    throw errorResponse(400, "Invalid part number");
  const expected = Math.min(PART_SIZE, row.size - (partNumber - 1) * PART_SIZE);
  if (Number(request.headers.get("content-length")) !== expected)
    throw errorResponse(400, "Part length does not match upload");
  const bytes = await request.arrayBuffer();
  if (bytes.byteLength !== expected)
    throw errorResponse(400, "Invalid part size");
  const digest = Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
  )
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  const multipart = requireResourceBindings(
    "FILES_BUCKET",
  ).FILES_BUCKET.resumeMultipartUpload(row.objectKey, row.multipartId!);
  const part = await multipart.uploadPart(partNumber, bytes);
  await db
    .insert(uploadParts)
    .values({
      uploadId: id,
      partNumber,
      etag: part.etag,
      size: expected,
      digest,
    })
    .onConflictDoUpdate({
      target: [uploadParts.uploadId, uploadParts.partNumber],
      set: { etag: part.etag, size: expected, digest },
    });
  return { ...part, digest };
}
export async function completeMultipart(auth: RequestAuth, id: string) {
  const row = await authorizeUpload(auth, id);
  if (row.status === "committed") return { ok: true }; // Retrying a lost completion response is safe.
  active(row);
  const parts = await db
    .select()
    .from(uploadParts)
    .where(eq(uploadParts.uploadId, id))
    .orderBy(asc(uploadParts.partNumber));
  if (
    parts.length !== Math.ceil(row.size / PART_SIZE) ||
    parts.some((p, i) => p.partNumber !== i + 1) ||
    parts.reduce((sum, p) => sum + p.size, 0) !== row.size
  )
    throw errorResponse(409, "Upload still has missing parts");
  await db
    .update(uploads)
    .set({ status: "completing" })
    .where(and(eq(uploads.id, id), eq(uploads.status, "pending")));
  const { FILES_BUCKET } = requireResourceBindings("FILES_BUCKET");
  let object = await FILES_BUCKET.head(row.objectKey);
  if (!object)
    object = await FILES_BUCKET.resumeMultipartUpload(
      row.objectKey,
      row.multipartId!,
    ).complete(parts);
  return {
    entry: await commitUpload(auth.user, id, object.etag ?? "uploaded"),
  };
}
export async function abortMultipart(auth: RequestAuth, id: string) {
  const row = await authorizeUpload(auth, id);
  active(row);
  // Never abort a completion in progress. Expiry cleanup can recover abandoned finalizations.
  if (row.status !== "pending")
    throw errorResponse(409, "Upload is being completed");
  const result = await db
    .update(uploads)
    .set({ status: "expired" })
    .where(and(eq(uploads.id, id), eq(uploads.status, "pending")))
    .returning({ id: uploads.id });
  if (!result.length) throw errorResponse(409, "Upload changed");
  await requireResourceBindings("FILES_BUCKET")
    .FILES_BUCKET.resumeMultipartUpload(row.objectKey, row.multipartId!)
    .abort();
}
