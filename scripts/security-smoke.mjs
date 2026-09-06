// Uses only disposable local fixtures. Never accepts a production URL.
import assert from "node:assert/strict";
const base = "http://localhost:8787";
const prefix = `/security-${Date.now()}`;
const alice = "agfs_local_test_alice";
const bob = "agfs_local_test_bob";
let checks = 0;
async function request(path, { token = alice, status = 200, body, method = body ? "POST" : "GET", headers = {} } = {}) {
  const response = await fetch(`${base}${path}`, { method, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body ? { "content-type": "application/json" } : {}), ...headers }, ...(body ? { body: JSON.stringify(body) } : {}) });
  assert.equal(response.status, status, `${method} ${path}: ${await response.clone().text()}`);
  checks++;
  return response;
}
await request("/api/v1/whoami", { token: null, status: 401 });
await request("/api/v1/whoami");
await request("/api/v1/tokens", { method: "DELETE", headers: { origin: "https://evil.example" }, status: 403 });
for (const name of ["a_b", "axb", "a%b", "AB", "ab", "😀"]) {
  await request("/api/v1/fs/mkdir", { body: { path: `${prefix}/${name}/child` } });
}
await request("/api/v1/fs/delete", { body: { path: `${prefix}/a_b`, recursive: true } });
await request(`/api/v1/fs/list?path=${encodeURIComponent(`${prefix}/axb`)}`);
const html = '<script>document.body.dataset.executed="yes"</script>';
const intent = await (await request("/api/v1/fs/upload-intents", { body: { path: `${prefix}/artifact.html`, contentType: "text/html", size: Buffer.byteLength(html) } })).json();
let response = await fetch(intent.url, { method: "PUT", headers: intent.headers, body: html });
assert.equal(response.status, 200, await response.clone().text()); checks++;
response = await fetch(intent.url, { method: "PUT", headers: intent.headers, body: html });
assert.equal(response.status, 409, await response.clone().text()); checks++;
await request(`/api/v1/fs/uploads/${intent.uploadId}/commit`, { token: bob, body: { etag: "etag" }, status: 400 });
await request(`/api/v1/fs/uploads/${intent.uploadId}/commit`, { body: { etag: "etag" } });
await request(`/api/v1/fs/uploads/${intent.uploadId}/commit`, { body: { etag: "etag" }, status: 409 });
response = await request(`/api/v1/fs/download?path=${encodeURIComponent(`${prefix}/artifact.html`)}`);
assert.equal(await response.text(), html);
assert.equal(response.headers.get("cache-control"), "private, no-store");
await request(`/api/v1/fs/download?path=${encodeURIComponent(`${prefix}/artifact.html`)}`, { token: bob, status: 404 });
const { share } = await (await request("/api/v1/shares", { body: { path: `${prefix}/artifact.html`, ttl: "15m" } })).json();
response = await fetch(share.url);
assert.equal(response.status, 200);
assert.match(response.headers.get("content-disposition"), /^attachment;/);
assert.match(response.headers.get("content-security-policy"), /sandbox;/);
assert.equal(response.headers.get("cache-control"), "private, no-store"); checks++;
await request(`/api/v1/shares/${share.id}`, { method: "DELETE" });
await request(new URL(share.url).pathname, { token: null, status: 404 });
const device = await (await request("/api/v1/device/start", { token: null, body: { clientName: "local security smoke" } })).json();
await request("/api/v1/device/approve", { body: { userCode: device.userCode, label: "local audit" } });
await request("/api/v1/device/approve", { body: { userCode: device.userCode, label: "duplicate" }, status: 400 });
const approved = await (await request("/api/v1/device/poll", { token: null, body: { deviceCode: device.deviceCode } })).json();
assert.equal(approved.status, "approved");
await request("/api/v1/whoami", { token: approved.accessToken });
const consumed = await (await request("/api/v1/device/poll", { token: null, body: { deviceCode: device.deviceCode } })).json();
assert.equal(consumed.status, "expired");
await request("/api/v1/fs/delete", { body: { path: prefix, recursive: true } });
console.log(`Passed ${checks} local HTTP checks: auth, owner isolation, literal paths, upload/commit/replay, safe shares/revocation, device login/replay.`);
