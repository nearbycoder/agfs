import { ZodError, type ZodType } from "zod";
import { InputError } from "@agfs/db";

export function json<T>(data: T, init?: ResponseInit): Response {
  const headers = new Headers(init?.headers);
  headers.set("cache-control", "no-store");
  headers.set("x-content-type-options", "nosniff");
  return Response.json(data, { ...init, headers });
}

export function errorResponse(status: number, message: string): Response {
  return json({ error: message }, { status });
}

function encodeDispositionFilename(filename: string): string {
  return encodeURIComponent(filename).replace(/['()*]/g, (char) => {
    return `%${char.charCodeAt(0).toString(16).toUpperCase()}`;
  });
}

export function createContentDisposition(
  disposition: "attachment" | "inline",
  filename: string,
): string {
  const fallback =
    filename
      .replace(/[^\x20-\x7E]/g, "_")
      .replace(/["\\]/g, "_")
      .trim() || "download";

  return `${disposition}; filename="${fallback}"; filename*=UTF-8''${encodeDispositionFilename(filename)}`;
}

export function handleRouteError(error: unknown): Response {
  if (error instanceof Response) {
    return error;
  }

  if (error instanceof InputError) return errorResponse(400, error.message);
  if (error instanceof ZodError || error instanceof SyntaxError)
    return errorResponse(400, "Invalid request");
  console.error(
    "Unexpected route error",
    error instanceof Error ? error.name : "Unknown error",
  );
  return errorResponse(500, "Request failed");
}

export async function parseJson<T>(
  request: Request,
  schema: ZodType<T>,
): Promise<T> {
  if (
    request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !==
    "application/json"
  ) {
    throw errorResponse(415, "Content-Type must be application/json");
  }
  const reader = request.body?.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  if (reader) {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 16_384) {
        await reader.cancel();
        throw errorResponse(413, "Request body too large");
      }
      chunks.push(value);
    }
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const payload = JSON.parse(new TextDecoder().decode(bytes));
  return schema.parse(payload);
}

export function parseSearch<T>(request: Request, schema: ZodType<T>): T {
  const url = new URL(request.url);
  const params = Object.fromEntries(url.searchParams.entries());
  return schema.parse(params);
}

export function getBearerToken(request: Request): string | null {
  const value = request.headers.get("authorization");
  if (!value) {
    return null;
  }

  const [type, token] = value.split(" ");
  if (!["bearer", "dpop"].includes(type?.toLowerCase()) || !token) {
    return null;
  }

  return token.trim();
}

export function requireSameOriginMutation(
  request: Request,
  appUrl: string,
): void {
  if (["GET", "HEAD", "OPTIONS"].includes(request.method)) return;
  const origin = request.headers.get("origin");
  const site = request.headers.get("sec-fetch-site");
  if (
    (origin && origin !== new URL(appUrl).origin) ||
    site === "cross-site" ||
    site === "same-site"
  ) {
    throw errorResponse(403, "Cross-origin request forbidden");
  }
}
