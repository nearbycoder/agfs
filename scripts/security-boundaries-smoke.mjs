// Disposable local fixtures only; never accepts a production URL.
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { cookie, database } from "./platform-fixtures.mjs";
const base = "http://localhost:8787",
  alice = cookie(),
  bob = cookie("bob");
let checks = 0;
async function req(
  path,
  {
    session = alice,
    token,
    workspace,
    status = 200,
    method,
    body,
    headers = {},
  } = {},
) {
  const r = await fetch(base + path, {
    method: method ?? (body === undefined ? "GET" : "POST"),
    headers: {
      ...(token ? { authorization: "Bearer " + token } : { cookie: session }),
      ...(workspace ? { "x-agfs-workspace": workspace } : {}),
      ...(body === undefined
        ? {}
        : { "content-type": "application/json", origin: base }),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  assert.equal(r.status, status, `${path}: ${await r.clone().text()}`);
  checks++;
  return r;
}
const json = async (...args) => (await req(...args)).json();
function credential(owner, issuer) {
  const id = "tok_" + randomUUID().replaceAll("-", ""),
    token = "agfs_audit_" + randomUUID().replaceAll("-", "");
  database
    .prepare(
      "INSERT INTO api_tokens(id,owner_id,issued_by,label,token_hash,prefix,path_prefix,permissions,created_at,expires_at) VALUES(?,?,?,?,?,?,?,?,?,?)",
    )
    .run(
      id,
      owner,
      issuer,
      "Security regression",
      createHash("sha256").update(token).digest("hex"),
      "agfs_audit",
      "/",
      JSON.stringify(["read", "write", "manage"]),
      Date.now(),
      Date.now() + 3600000,
    );
  return { id, token };
}
const workspace = await json("/api/v1/platform/workspaces", {
  body: { name: "Security boundary " + Date.now() },
  status: 201,
});
const own = credential(workspace.id, "alice"),
  limited = credential("alice", "alice");
database
  .prepare(
    "UPDATE api_tokens SET path_prefix='/limited',permissions='[\"read\"]' WHERE id=?",
  )
  .run(limited.id);
const listed = await json("/api/v1/platform/workspaces");
assert(listed.workspaces.some((w) => w.id === workspace.id));
await req("/api/v1/platform/workspaces", { token: limited.token, status: 403 });
await req("/api/v1/platform/workspaces", { token: own.token, status: 403 });
async function invite() {
  const i = await json("/api/v1/platform/invites", {
    workspace: workspace.id,
    body: { email: "bob@example.test", role: "editor" },
    status: 201,
  });
  await req("/api/v1/platform/invites/accept", {
    session: bob,
    body: { token: i.token },
  });
}
await invite();
const member = credential(workspace.id, "bob"),
  alias = "agfs_alias_" + randomUUID().replaceAll("-", "");
database
  .prepare(
    "INSERT INTO token_rotation_aliases(token_hash,token_id,expires_at) VALUES(?,?,?)",
  )
  .run(
    createHash("sha256").update(alias).digest("hex"),
    member.id,
    Date.now() + 600000,
  );
await req("/api/v1/fs/list?path=/", { token: member.token });
await req("/api/v1/fs/list?path=/", { token: alias });
await req("/api/v1/platform/members", {
  workspace: workspace.id,
  method: "PATCH",
  body: { userId: "alice", role: null },
  status: 409,
});
await req("/api/v1/fs/list?path=/", { token: own.token });
await req("/api/v1/platform/members", {
  workspace: workspace.id,
  method: "PATCH",
  body: { userId: "bob", role: null },
});
assert(
  database
    .prepare("SELECT revoked_at FROM api_tokens WHERE id=?")
    .get(member.id).revoked_at,
);
checks++;
for (const token of [member.token, alias])
  await req("/api/v1/fs/list?path=/", { token, status: 401 });
await invite();
for (const token of [member.token, alias])
  await req("/api/v1/fs/list?path=/", { token, status: 401 });
await req("/api/v1/platform/workspaces", { token: member.token, status: 401 });
await req("/api/v1/fs/list?path=/", {
  token: credential(workspace.id, "bob").token,
});
await req("/api/v1/fs/list?path=/", { token: own.token });
// Invalid requests must not reserve idempotency keys or bypass the body cap.
const count = () =>
  database.prepare("SELECT count(*) AS n FROM idempotency").get().n;
const before = count();
// Consecutive rejected bodies must leave the next request usable too.
for (let attempt = 0; attempt < 3; attempt++)
  for (const [type, status] of [
    ["Application/JSON; charset=utf-8", 413],
    ["text/plain", 413],
  ])
    await req("/api/v1/platform/runs", {
      body: { path: "/", name: "oversized", padding: "x".repeat(20000) },
      headers: { "content-type": type, "idempotency-key": randomUUID() },
      status,
    });
await req("/api/v1/platform/runs", {
  body: { path: "/" },
  headers: { "content-type": "text/plain", "idempotency-key": randomUUID() },
  status: 415,
});
await req("/api/v1/platform/runs", {
  body: null,
  headers: { "idempotency-key": randomUUID() },
  status: 400,
});
assert.equal(count(), before);
checks++;
for (const path of ["/api/v1/%", "/api/v1/%FF", "/%E0%A4"]) {
  const r = await req(path, { status: 400 });
  assert.equal(r.headers.get("x-content-type-options"), "nosniff");
  assert.equal((await r.json()).error, "Invalid request path");
}
const input = { name: "Bounded replay", path: "/" },
  headers = {
    "content-type": "Application/JSON",
    "idempotency-key": randomUUID(),
  };
const first = await json("/api/v1/platform/runs", {
  body: input,
  headers,
  status: 201,
});
const replay = await req("/api/v1/platform/runs", {
  body: input,
  headers,
  status: 201,
});
assert.equal(replay.headers.get("idempotency-replayed"), "true");
assert.deepEqual(await replay.json(), first);
checks++;
console.log(`Security boundary regressions passed: ${checks} checks.`);
