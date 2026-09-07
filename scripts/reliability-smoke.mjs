import assert from "node:assert/strict";
import { cookie, database } from "./platform-fixtures.mjs";
import { AgfsClient } from "../packages/sdk/dist/index.js";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
const base = "http://localhost:8787",
  alice = cookie(),
  bob = cookie("bob"),
  root = "/reliability-" + Date.now();
let checks = 0;
async function req(
  path,
  {
    body,
    method = body === undefined ? "GET" : "POST",
    status = 200,
    session = alice,
    token,
    workspace,
    headers = {},
  } = {},
) {
  const r = await fetch(base + "/api/v1" + path, {
    method,
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
  assert.equal(r.status, status, path + ": " + (await r.clone().text()));
  checks++;
  return r;
}
const j = async (...args) => (await req(...args)).json(),
  p = (path, options) => j("/platform" + path, options);
const client = new AgfsClient({
  token: "agfs_local_test_alice",
  baseUrl: base,
});
await client.mkdir(root);
await client.upload(root + "/file.txt", new Blob(["first"]), { ifMatch: null });
const checkpoint = await p("/changes?path=" + root);
const snap = await p("/snapshots", {
  body: { name: "Recovery check", path: root, days: 1 },
  status: 201,
});
await p("/snapshots/" + snap.id + "/manifest", { session: bob, status: 404 });
await client.upload(root + "/file.txt", new Blob(["second"]));
const changes = await p(
  "/changes?path=" + root + "&since=" + checkpoint.checkpoint,
);
assert(changes.changes.some((c) => c.path === root + "/file.txt"));
checks++;
await p("/snapshots/" + snap.id + "/restore", { body: {} });
assert.equal(await client.readText(root + "/file.txt"), "first");
checks++;
const headers = { "idempotency-key": "create-draft-" + Date.now() },
  body = { name: "Retry safe", path: root };
const first = await p("/drafts", { body, headers, status: 201 }),
  again = await p("/drafts", { body, headers, status: 201 });
assert.equal(first.id, again.id);
checks++;
await p("/drafts", {
  body: { ...body, name: "Different" },
  headers,
  status: 409,
});
const created = await j("/tokens", {
  body: {
    label: "Rotation check",
    pathPrefix: root,
    permissions: ["read"],
    ttl: "1d",
  },
});
const rotated = await p("/tokens/" + created.record.id + "/rotate", {
  body: {},
});
await j("/fs/list?path=" + root, { token: created.token });
await j("/fs/list?path=" + root, { token: rotated.token });
await j("/tokens/" + created.record.id, { method: "DELETE" });
await j("/whoami", { token: rotated.token, status: 401 });
await j("/whoami", { token: created.token, status: 401 });
await client.upload(
  root + "/secret.txt",
  new Blob(["-----BEGIN PRIVATE KEY-----\nfake-test-fixture"]),
  { ifMatch: null },
);
const scan = await j("/shares", {
  body: { path: root + "/secret.txt", ttl: "15m" },
  status: 409,
});
assert.equal(scan.code, "secret_review_required");
checks++;
await j("/shares", {
  token: "agfs_local_test_alice",
  body: { path: root + "/secret.txt", ttl: "15m", approvedEtag: scan.etag },
  status: 409,
});
const shared = await j("/shares", {
  body: { path: root + "/secret.txt", ttl: "15m", approvedEtag: scan.etag },
});
assert.equal((await fetch(shared.share.url)).status, 200);
checks++;
await client.upload(root + "/secret.txt", new Blob(["changed"]));
assert.equal((await fetch(shared.share.url)).status, 404);
checks++;
const ws = await p("/workspaces", {
  body: { name: "Review team" },
  status: 201,
});
const invite = await p("/invites", {
  workspace: ws.id,
  body: { email: "bob@example.test", role: "editor" },
  status: 201,
});
await p("/invites/accept", { session: bob, body: { token: invite.token } });
await p("/review-policy", {
  workspace: ws.id,
  method: "PUT",
  body: { independentReview: true },
});
const draft = await p("/drafts", {
  workspace: ws.id,
  body: { name: "Independent review", path: "/" },
  status: 201,
});
await p("/drafts/" + draft.id + "/changes", {
  workspace: ws.id,
  method: "PUT",
  body: { path: "/new.txt", operation: "write", content: "proposal" },
});
await p("/drafts/" + draft.id + "/review", {
  workspace: ws.id,
  body: { accept: true },
  status: 403,
});
await p("/drafts/" + draft.id + "/request-changes", {
  workspace: ws.id,
  body: { body: "Please clarify the wording." },
});
await p("/drafts/" + draft.id + "/changes", {
  workspace: ws.id,
  method: "PUT",
  body: { path: "/new.txt", operation: "write", content: "revised" },
});
await p("/drafts/" + draft.id + "/resubmit", { workspace: ws.id, body: {} });
await p("/ownership", { workspace: ws.id, body: { userId: "bob" } });
await p("/ownership/accept", { workspace: ws.id, body: {}, status: 404 });
await p("/ownership/accept", { workspace: ws.id, session: bob, body: {} });
await p("/drafts/" + draft.id + "/review", {
  workspace: ws.id,
  session: bob,
  body: { accept: true },
});
await p("/members", { workspace: ws.id, status: 403 });
const pending = await p("/invites", {
  workspace: ws.id,
  session: bob,
  body: { email: "alice@example.test", role: "viewer" },
  status: 201,
});
await p("/invites/" + pending.id, {
  workspace: ws.id,
  session: bob,
  method: "DELETE",
});
await p("/invites/accept", { body: { token: pending.token }, status: 404 });
const run = await p("/runs", {
  body: {
    name: "Pinned run",
    path: root,
    inputs: [root + "/file.txt"],
    retentionDays: 1,
  },
  status: 201,
});
await p("/runs/" + run.id + "/complete", { body: {} });
assert(
  database
    .prepare("SELECT count(*) AS n FROM object_pins WHERE reference_id=?")
    .get(run.id).n >= 2,
);
checks++;
await client.upload(root + "/file.txt", new Blob(["changed after run"]));
const retained = await req(
  "/platform/runs/" +
    run.id +
    "/file?" +
    new URLSearchParams({ path: root + "/file.txt", kind: "input" }),
);
assert.equal(await retained.text(), "first");
checks++;
await req(
  "/platform/runs/" +
    run.id +
    "/file?" +
    new URLSearchParams({ path: root + "/file.txt", kind: "output" }),
  { session: bob, status: 404 },
);
await client.upload(root + "/file.txt", new Blob(["first"]));
await p("/search/reindex", { body: {} });
await p("/health");
await p("/health", { session: bob });
const dir = await mkdtemp("/tmp/agfs-backup-check-");
async function command(args) {
  await new Promise((resolve, reject) => {
    const c = spawn(process.execPath, ["scripts/backup.mjs", ...args], {
      env: {
        ...process.env,
        AGFS_BASE_URL: base,
        AGFS_TOKEN: "agfs_local_test_alice",
      },
      stdio: "inherit",
    });
    c.on("exit", (code) =>
      code === 0 ? resolve() : reject(new Error("Backup command failed")),
    );
  });
}
await command(["export", dir, root]);
await command(["verify", dir]);
await command(["restore", dir, root + "-restored"]);
assert.equal(await client.readText(root + "-restored/file.txt"), "first");
checks += 3;
await p("/snapshots/" + snap.id, { method: "DELETE" });
console.log("Reliability integration checks passed: " + checks);
