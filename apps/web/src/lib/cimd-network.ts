import { getBindings } from "./bindings";
// Service binding has no public route. Node's official transport validates every DNS
// answer, pins the connection, and preserves hostname verification and TLS SNI.
export async function fetchClientMetadataResource(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const service = getBindings().CIMD_EGRESS;
  if (!service) throw new Error("CIMD egress is not configured");
  const request = new Request(input, { ...init, redirect: "manual" });
  const headers = new Headers();
  for (const key of ["accept", "if-none-match", "if-modified-since"]) {
    const value = request.headers.get(key);
    if (value) headers.set(key, value);
  }
  return service.fetch(
    "http://metadata/fetch?" + new URLSearchParams({ url: request.url }),
    {
      method: request.method,
      headers,
      redirect: "manual",
      signal: request.signal,
    },
  );
}
