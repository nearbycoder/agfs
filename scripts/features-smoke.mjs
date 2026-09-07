// Disposable local fixtures only. Exercises real D1/R2 bindings and MCP clients.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  Client,
  StreamableHTTPClientTransport,
} from "../apps/web/node_modules/@modelcontextprotocol/client/dist/index.mjs";
const base = "http://localhost:8787",
  alice = "agfs_local_test_alice",
  bob = "agfs_local_test_bob",
  root = `/features-${Date.now()}`;
let checks = 0;
async function req(path, { token = alice, status = 200, body, method = body ? "POST" : "GET", headers = {} } = {}) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, ...(body ? { "content-type": "application/json" } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  assert.equal(response.status, status, `${method} ${path}: ${await response.clone().text()}`);
  checks++;
  return response;
}
const data = async (path, options) => (await req(path, options)).json();
async function write(path, text) {
  const intent = await data("/api/v1/fs/upload-intents", {
    body: { path, contentType: "text/plain", size: Buffer.byteLength(text) },
  });
  const put = await fetch(intent.url, { method: "PUT", headers: intent.headers, body: text });
  assert.equal(put.status, 200);
  checks++;
  return data(`/api/v1/fs/uploads/${intent.uploadId}/commit`, { body: { etag: "uploaded" } });
}
await write(`${root}/file.txt`, "original");
const scoped = await data("/api/v1/tokens", {
  body: { label: "Local reader", pathPrefix: root, permissions: ["read"] },
});
assert(scoped.record.expiresAt);
checks++;
await req(`/api/v1/fs/list?path=${root}`, { token: scoped.token });
for (const path of ["/", `${root}-outside`])
  await req(`/api/v1/fs/list?path=${path}`, { token: scoped.token, status: 403 });
await req("/api/v1/fs/mkdir", { token: scoped.token, body: { path: `${root}/forbidden` }, status: 403 });
await req("/api/v1/tokens", { token: scoped.token, body: { label: "Escalate", permissions: ["manage"] }, status: 403 });
await req("/api/v1/shares", { token: scoped.token, body: { path: `${root}/file.txt`, ttl: "15m" }, status: 403 });
await req("/api/v1/tokens", { body: { label: "Too long", ttl: "91d" }, status: 400 });
const mover = await data("/api/v1/tokens", {
  body: { label: "Local mover", pathPrefix: root, permissions: ["read", "write", "delete"] },
});
await req("/api/v1/fs/mkdir", { body: { path: `${root}/move_from/nested` } });
await req("/api/v1/fs/move", { token: mover.token, body: { from: `${root}/move_from`, to: `${root}-outside` }, status: 403 });
await req("/api/v1/fs/move", { token: mover.token, body: { from: `${root}/move_from`, to: `${root}/$&` } });
await req(`/api/v1/fs/list?path=${encodeURIComponent(`${root}/$&/nested`)}`, { token: mover.token });
await req(`/api/v1/tokens/${mover.record.id}`, { method: "DELETE" });
const share = await data("/api/v1/shares", { body: { path: `${root}/file.txt`, ttl: "15m" } });
await write(`${root}/file.txt`, "replacement");
let history = await data(`/api/v1/recovery?reason=version&path=${root}`);
assert.equal(history.items.length, 1);
checks++;
await req("/api/v1/recovery/restore", { body: { id: history.items[0].id }, status: 409 });
await req("/api/v1/recovery/restore", {
  token: bob,
  body: { id: history.items[0].id, path: `${root}/stolen` },
  status: 404,
});
await req("/api/v1/recovery/restore", { body: { id: history.items[0].id, path: `${root}/restored.txt` } });
assert.equal(await (await req(`/api/v1/fs/download?path=${root}/restored.txt`)).text(), "original");
const preview = await data("/api/v1/fs/preview", { body: { path: `${root}/file.txt`, ttl: "15m" } });
let response = await fetch(preview.url);
assert.equal(response.status, 200, await response.clone().text());
assert.match(response.headers.get("content-security-policy"), /sandbox/);
assert.equal(await response.text(), "replacement");
checks++;
response = await fetch(preview.url + "tampered");
assert.equal(response.status, 403);
checks++;
await req("/api/v1/fs/delete", { body: { path: root, recursive: true } });
await req(new URL(share.share.url).pathname, { status: 404 });
const trash = await data(`/api/v1/recovery?reason=trash&path=${root}`);
const folder = trash.items.find((i) => i.path === root);
assert(folder);
await req("/api/v1/recovery/restore", { body: { id: folder.id, path: `${root}-restored` } });
assert.equal(await (await req(`/api/v1/fs/download?path=${root}-restored/file.txt`)).text(), "replacement");
const partSize = 8 * 1024 * 1024;
const bytes = Buffer.alloc(partSize + 137, 97);
const input = {
  path: `${root}/large.bin`,
  contentType: "application/octet-stream",
  size: bytes.length,
  fingerprint: "local-smoke",
};
const upload = await data("/api/v1/fs/resumable", { body: input });
response = await fetch(`${base}/api/v1/fs/resumable/${upload.uploadId}/parts/1`, {
  method: "PUT",
  headers: { authorization: `Bearer ${alice}` },
  body: bytes.subarray(0, partSize),
});
assert.equal(response.status, 200, await response.clone().text());
checks++;
const resumed = await data("/api/v1/fs/resumable", { body: input });
assert.equal(resumed.uploadId, upload.uploadId);
assert.equal(resumed.parts.length, 1);
assert.equal(resumed.parts[0].digest, createHash("sha256").update(bytes.subarray(0, partSize)).digest("hex"));
checks++;
await req(`/api/v1/fs/resumable/${upload.uploadId}`, { token: bob, status: 404 });
await req(`/api/v1/fs/resumable/${upload.uploadId}/complete`, { body: {}, status: 409 });
response = await fetch(`${base}/api/v1/fs/resumable/${upload.uploadId}/parts/2`, {
  method: "PUT",
  headers: { authorization: `Bearer ${alice}` },
  body: bytes.subarray(partSize),
});
assert.equal(response.status, 200, await response.clone().text());
checks++;
await req(`/api/v1/fs/resumable/${upload.uploadId}/complete`, { body: {} });
await req(`/api/v1/fs/resumable/${upload.uploadId}/complete`, { body: {} });
response = await req(`/api/v1/fs/download?path=${root}/large.bin`);
assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes);
checks++;
for (const mode of ["legacy", { pin: "2026-07-28" }]) {
  const client = new Client({ name: "agfs-smoke", version: "1" }, { versionNegotiation: { mode } });
  const transport = new StreamableHTTPClientTransport(new URL(`${base}/mcp`), {
    requestInit: { headers: { authorization: `Bearer ${alice}` } },
  });
  await client.connect(transport);
  assert.equal(transport.sessionId, undefined);
  checks++;
  const listed = await client.listTools();
  assert(listed.tools.some((t) => t.name === "fs_write"));
  checks++;
  const writeResult = await client.callTool({
    name: "fs_write",
    arguments: { path: `${root}/mcp.txt`, text: "MCP content" },
  });
  assert(!writeResult.isError, JSON.stringify(writeResult));
  checks++;
  const read = await client.callTool({ name: "fs_read", arguments: { path: `${root}/mcp.txt` } });
  assert.match(read.content[0].text, /MCP content/);
  checks++;
  await client.close();
}
const restricted = new Client(
  { name: "restricted", version: "1" },
  { versionNegotiation: { mode: { pin: "2026-07-28" } } },
);
await restricted.connect(
  new StreamableHTTPClientTransport(new URL(`${base}/mcp`), {
    requestInit: { headers: { authorization: `Bearer ${scoped.token}` } },
  }),
);
const denied = await restricted.callTool({
  name: "fs_write",
  arguments: { path: `${root}/forbidden.txt`, text: "no" },
});
assert.equal(denied.isError, true);
checks++;
await restricted.close();
const events = await data("/api/v1/activity");
assert(events.events.some((e) => e.action === "upload.commit" && e.tokenId));
checks++;
await req(`/api/v1/tokens/${scoped.record.id}`, { method: "DELETE" });
await req(`/api/v1/fs/list?path=${root}`, { token: scoped.token, status: 401 });
console.log(`${checks} feature integration checks passed (${root})`);
