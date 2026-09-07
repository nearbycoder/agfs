import { createServer } from "node:http";
import { fetchClientMetadataResource } from "@better-auth/cimd/node";
export async function metadata(url, headers = {}, method = "GET") {
  const parsed = new URL(url);
  if (
    parsed.protocol !== "https:" ||
    parsed.username ||
    parsed.password ||
    parsed.hash ||
    (parsed.port && parsed.port !== "443") ||
    !["GET", "HEAD"].includes(method)
  )
    throw new Error("Invalid metadata request");
  const safe = new Headers();
  for (const key of ["accept", "if-none-match", "if-modified-since"])
    if (headers[key]) safe.set(key, headers[key]);
  safe.set("accept-encoding", "identity");
  const response = await fetchClientMetadataResource(url, {
    method,
    headers: safe,
    redirect: "manual",
    signal: AbortSignal.timeout(10000),
  });
  const chunks = [];
  let size = 0;
  if (response.body)
    for await (const chunk of response.body) {
      size += chunk.length;
      if (size > 131072) throw new Error("Metadata too large");
      chunks.push(chunk);
    }
  const outputHeaders = {};
  for (const key of [
    "content-type",
    "etag",
    "last-modified",
    "cache-control",
    "location",
  ])
    if (response.headers.has(key))
      outputHeaders[key] = response.headers.get(key);
  return {
    status: response.status,
    headers: outputHeaders,
    body: Buffer.concat(chunks),
  };
}
let active = 0;
export function server() {
  return createServer(
    { maxHeaderSize: 16384, requestTimeout: 15000, headersTimeout: 5000 },
    async (req, res) => {
      if (req.url === "/ready") {
        res.end("ready");
        return;
      }
      if (!["GET", "HEAD"].includes(req.method) || req.url.length > 8192) {
        res.writeHead(400).end();
        return;
      }
      if (active >= 4) {
        res.writeHead(429, { "retry-after": "1" }).end();
        return;
      }
      active++;
      try {
        const target = new URL(req.url, "http://metadata").searchParams.get(
          "url",
        );
        const r = await metadata(target, req.headers, req.method);
        res.writeHead(r.status, r.headers);
        res.end(r.body);
      } catch {
        res.writeHead(502).end("Metadata resource rejected or unavailable");
      } finally {
        active--;
      }
    },
  );
}
if (!process.env.AGFS_CIMD_TEST) server().listen(8080, "0.0.0.0");
