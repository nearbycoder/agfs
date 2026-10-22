import type { UploadIntent } from "@agfs/contracts";
import { requireResourceBindings, requireStringBindings } from "./bindings";

export async function createUploadIntentUrl(options: {
  objectKey: string;
  contentType: string;
  uploadId: string;
  uploadToken: string;
  expiresAt: Date;
}): Promise<UploadIntent> {
  // A reusable presigned PUT can overwrite committed content and evade quotas.
  // Route uploads through the Worker so size and create-only writes are enforced.
  const { APP_URL } = requireStringBindings("APP_URL");
  return {
    uploadId: options.uploadId,
    url: new URL(`/api/v1/fs/uploads/${options.uploadId}/blob`, APP_URL).toString(),
    method: "PUT",
    headers: {
      "Content-Type": options.contentType,
      "X-AGFS-Upload-Token": options.uploadToken,
    },
    objectKey: options.objectKey,
    expiresAt: options.expiresAt.toISOString(),
  };
}

export async function putObject(objectKey: string, body: ReadableStream<Uint8Array> | ArrayBuffer, contentType: string) {
  const { FILES_BUCKET } = requireResourceBindings("FILES_BUCKET");
  return FILES_BUCKET.put(objectKey, body, {
    onlyIf: { etagDoesNotMatch: "*" },
    httpMetadata: {
      contentType,
    },
  });
}

/** A syntactically unsupported range is ignored; a valid but empty range is 416. */
function byteRange(value: string, size: number): { offset: number; length: number } | null | undefined {
  const match = /^bytes=(\d*)-(\d*)$/.exec(value.trim());
  if (!match || (!match[1] && !match[2])) return undefined;
  if (size === 0) return null;
  if (!match[1]) {
    const length = Math.min(size, Number(match[2]));
    return length > 0 ? { offset: size - length, length } : null;
  }
  const offset = Number(match[1]), end = match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
  if (offset >= size || end < offset) return null;
  return { offset, length: end - offset + 1 };
}

export async function streamObject(objectKey: string, init?: ResponseInit, request?: Request): Promise<Response> {
  const { FILES_BUCKET } = requireResourceBindings("FILES_BUCKET");
  const headers = new Headers(init?.headers);
  headers.set("cache-control", "private, no-store");
  headers.set("x-content-type-options", "nosniff");
  headers.set("content-security-policy", "sandbox; default-src 'none'; frame-ancestors 'none'");
  headers.set("referrer-policy", "no-referrer");
  if (request) headers.set("accept-ranges", "bytes");
  let range: { offset: number; length: number } | undefined;
  let metadata: R2Object | null = null;
  const requested = request?.headers.get("range");
  // Avoid a HEAD on ordinary downloads, unsupported units, and multipart ranges.
  if (requested && /^bytes=\d*-\d*$/.test(requested.trim()) && requested.trim() !== "bytes=-") {
    metadata = await FILES_BUCKET.head(objectKey);
    if (!metadata) return new Response("Not found", { status: 404, headers });
    const ifRange = request?.headers.get("if-range");
    // Only a matching strong entity tag enables a conditional range. Dates and
    // weak/unknown validators fall back to the complete current representation.
    if (!ifRange || ifRange === `"${metadata.etag}"`) {
      const parsed = byteRange(requested, metadata.size);
      if (parsed === null) {
        headers.set("content-range", `bytes */${metadata.size}`);
        return new Response(null, { status: 416, headers });
      }
      range = parsed;
    }
  }
  const object = range
    ? await FILES_BUCKET.get(objectKey, { range, onlyIf: { etagMatches: metadata!.etag ?? "" } })
    : await FILES_BUCKET.get(objectKey);
  if (!object) return new Response("Not found", { status: 404, headers });
  if (!("body" in object)) return new Response("File changed", { status: 412, headers });
  headers.set("content-type", object.httpMetadata?.contentType ?? "application/octet-stream");
  if (object.size != null) headers.set("content-length", String(range?.length ?? object.size));
  if (object.etag) headers.set("etag", object.etag);
  if (range) headers.set("content-range", `bytes ${range.offset}-${range.offset + range.length - 1}/${metadata!.size}`);
  return new Response((object as R2Object).body, {
    ...init,
    ...(range ? { status: 206 } : {}),
    headers,
  });
}
