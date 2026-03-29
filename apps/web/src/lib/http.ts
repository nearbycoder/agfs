import type { ZodType } from "zod";

export function json<T>(data: T, init?: ResponseInit): Response {
  return Response.json(data, init);
}

export function errorResponse(status: number, message: string): Response {
  return json({ error: message }, { status });
}

function encodeDispositionFilename(filename: string): string {
  return encodeURIComponent(filename).replace(/['()*]/g, (char) => {
    return `%${char.charCodeAt(0).toString(16).toUpperCase()}`;
  });
}

export function createContentDisposition(disposition: "attachment" | "inline", filename: string): string {
  const fallback = filename
    .replace(/[^\x20-\x7E]/g, "_")
    .replace(/["\\]/g, "_")
    .trim() || "download";

  return `${disposition}; filename="${fallback}"; filename*=UTF-8''${encodeDispositionFilename(filename)}`;
}

export function handleRouteError(error: unknown): Response {
  if (error instanceof Response) {
    return error;
  }

  return errorResponse(400, error instanceof Error ? error.message : "Request failed");
}

export async function parseJson<T>(request: Request, schema: ZodType<T>): Promise<T> {
  const payload = await request.json();
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
  if (type?.toLowerCase() !== "bearer" || !token) {
    return null;
  }

  return token.trim();
}
