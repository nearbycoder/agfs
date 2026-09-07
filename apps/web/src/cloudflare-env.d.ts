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
  size: number;
  text(): Promise<string>;
  checksums: { sha256?: ArrayBuffer };
}

interface R2Bucket {
  delete(key: string): Promise<void>;
  get(key: string): Promise<R2Object | null>;
  head(key: string): Promise<R2Object | null>;
  put(
    key: string,
    value:
      | ReadableStream<Uint8Array>
      | ArrayBuffer
      | ArrayBufferView
      | string
      | Blob,
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
interface R2UploadedPart {
  partNumber: number;
  etag: string;
}
interface R2MultipartUpload {
  uploadId: string;
  uploadPart(partNumber: number, value: ArrayBuffer): Promise<R2UploadedPart>;
  complete(parts: R2UploadedPart[]): Promise<R2Object>;
  abort(): Promise<void>;
}
interface R2Bucket {
  createMultipartUpload(
    key: string,
    options?: { httpMetadata?: { contentType?: string } },
  ): Promise<R2MultipartUpload>;
  resumeMultipartUpload(key: string, uploadId: string): R2MultipartUpload;
}
interface D1PreparedStatement {
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
  bind(...values: unknown[]): D1PreparedStatement;
}
interface D1Database {
  prepare(query: string): D1PreparedStatement;
  batch(
    statements: D1PreparedStatement[],
  ): Promise<
    Array<{ results: Record<string, unknown>[]; meta: { changes: number } }>
  >;
}
