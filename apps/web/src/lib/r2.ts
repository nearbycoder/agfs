import { AwsClient } from "aws4fetch";
import type { UploadIntent } from "@agfs/contracts";
import { getBindings, requireResourceBindings, requireStringBindings } from "./bindings";

function encodeObjectKey(key: string): string {
  return key
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");
}

export async function createUploadIntentUrl(options: {
  objectKey: string;
  contentType: string;
  uploadId: string;
  uploadToken: string;
  expiresAt: Date;
}): Promise<UploadIntent> {
  const env = getBindings();
  const hasPresignBindings =
    typeof env.R2_ACCOUNT_ID === "string" &&
    typeof env.R2_BUCKET_NAME === "string" &&
    typeof env.R2_ACCESS_KEY_ID === "string" &&
    typeof env.R2_SECRET_ACCESS_KEY === "string" &&
    env.R2_ACCOUNT_ID.length > 0 &&
    env.R2_BUCKET_NAME.length > 0 &&
    env.R2_ACCESS_KEY_ID.length > 0 &&
    env.R2_SECRET_ACCESS_KEY.length > 0;

  if (!hasPresignBindings) {
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

  const bindings = requireStringBindings("R2_ACCOUNT_ID", "R2_BUCKET_NAME", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY");
  const url = new URL(
    `https://${bindings.R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${bindings.R2_BUCKET_NAME}/${encodeObjectKey(options.objectKey)}`,
  );
  url.searchParams.set(
    "X-Amz-Expires",
    String(Math.max(60, Math.floor((options.expiresAt.getTime() - Date.now()) / 1000))),
  );

  const client = new AwsClient({
    accessKeyId: bindings.R2_ACCESS_KEY_ID,
    secretAccessKey: bindings.R2_SECRET_ACCESS_KEY,
  });

  const signedRequest = await client.sign(
    new Request(url.toString(), {
      method: "PUT",
      headers: {
        "content-type": options.contentType,
      },
    }),
    {
      aws: { signQuery: true },
    },
  );

  return {
    uploadId: options.uploadId,
    url: signedRequest.url,
      method: "PUT",
      headers: {
        "Content-Type": options.contentType,
    },
    objectKey: options.objectKey,
    expiresAt: options.expiresAt.toISOString(),
  };
}

export async function putObject(objectKey: string, body: ReadableStream<Uint8Array> | ArrayBuffer, contentType: string) {
  const { FILES_BUCKET } = requireResourceBindings("FILES_BUCKET");
  return FILES_BUCKET.put(objectKey, body, {
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
