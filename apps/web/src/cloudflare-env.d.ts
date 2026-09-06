declare module "cloudflare:workers" {
  export const env: unknown;
}

interface D1Database {}

interface R2Object {
  body: ReadableStream<Uint8Array> | null;
  etag?: string;
  httpMetadata?: {
    contentType?: string;
  };
  size?: number;
}

interface R2Bucket {
  delete(key: string): Promise<void>;
  get(key: string): Promise<R2Object | null>;
  head(key: string): Promise<R2Object | null>;
  put(
    key: string,
    value: ReadableStream<Uint8Array> | ArrayBuffer | ArrayBufferView | string | Blob,
    options?: {
      onlyIf?: { etagDoesNotMatch: string };
      httpMetadata?: {
        contentType?: string;
      };
    },
  ): Promise<{
    etag?: string;
  } | null>;
}
