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

export async function streamObject(objectKey: string, init?: ResponseInit): Promise<Response> {
  const { FILES_BUCKET } = requireResourceBindings("FILES_BUCKET");
  const object = await FILES_BUCKET.get(objectKey);
  if (!object) {
    return new Response("Not found", { status: 404 });
  }

  const headers = new Headers(init?.headers);
  headers.set("cache-control", "private, no-store");
  headers.set("x-content-type-options", "nosniff");
  headers.set("content-security-policy", "sandbox; default-src 'none'; frame-ancestors 'none'");
  headers.set("referrer-policy", "no-referrer");
  headers.set("content-type", object.httpMetadata?.contentType ?? "application/octet-stream");
  if (object.size != null) {
    headers.set("content-length", String(object.size));
  }
  if (object.etag) {
    headers.set("etag", object.etag);
  }

  return new Response(object.body, {
    ...init,
    headers,
  });
}
