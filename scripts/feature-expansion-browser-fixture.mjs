// Creates synthetic local data only after the root authorizes a built fixture.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { lstatSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve, relative } from "node:path";
import { assertFixtureIdentity, createFixture, sha256 } from "./feature-expansion-fixtures.mjs";

export async function prepareBrowserFixture({ work, state, configPath, children, fixtureOnly, signal }) {
  const f = await createFixture("http://localhost:8787", { signal });
  await f.client.mkdir(f.root);
  for (const [name, content, contentType] of [
    ["records.json", '[{"id":"a","team":"north","amount":0.1},{"id":"b","team":"north","amount":0.2}]\n', "application/json"],
    ["table.csv", "id,team,amount\na,north,0.1\nb,north,0.2\n", "text/csv"],
    ["handoff.md", "# Local review\n- [ ] Review output\n- [x] Seed local fixture\n[Inert reference](https://example.invalid/review)\n", "text/markdown"],
    ["retained.txt", "Synthetic local browser fixture.\n", "text/plain"],
  ]) await f.client.upload(f.root + "/" + name, Buffer.from(content), { contentType });
  await f.ops("/background", { method: "PUT", body: { indexingPaused: true, webhooksPaused: true } });
  const failed = f.entry(f.root + "/failed-index.txt");
  f.db.prepare("UPDATE index_job_status SET attempts=2,last_error='Synthetic local failure',next_attempt=? WHERE entry_id=?")
    .run(Date.now() + 3600000, failed);
  const hook = f.hook(), delivery = f.delivery(hook);
  f.db.prepare("INSERT INTO health_alerts(id,owner_id,kind,message,created_at) VALUES(?,?,'indexing','Synthetic browser-review backlog',?)")
    .run(f.id + "-alert", f.id, Date.now());
  await f.api("/snapshots", { method: "POST", body: { name: "Local browser reference", path: f.root, days: 1 }, status: 201 });
  const pending = await (await f.request("/fs/upload-intents", { method: "POST", body: { path: f.root + "/pending.txt", contentType: "text/plain", size: 4 } })).json();
  // One page plus a continuation for the bounded budget selector; values remain synthetic.
  for (let n = 0; n < 51; n++) {
    const token = f.token();
    f.db.prepare("UPDATE api_tokens SET label=?,operation_limit=?,upload_limit=?,paused=? WHERE id=?")
      .run("Local budget " + String(n + 1).padStart(2, "0"), n % 3 ? null : 0, n % 2 ? 4096 : null, n % 7 === 0 ? 1 : 0, token.id);
  }
  const indexScope = f.root + "/index-pages";
  await f.client.mkdir(indexScope);
  let continuationFailure;
  for (let n = 0; n < 52; n++) {
    const entry = f.entry(indexScope + "/candidate-" + String(n).padStart(3, "0") + ".txt");
    if (n === 51) continuationFailure = entry;
  }
  f.db.prepare("UPDATE index_job_status SET attempts=1,last_error='Synthetic failure on continuation page',next_attempt=? WHERE entry_id=?")
    .run(Date.now() + 3600000, continuationFailure);
  // Historical inventory pages do not consume the 32 active-reservation ceiling.
  for (let n = 0; n < 51; n++) {
    const uploadId = "history-" + randomUUID();
    f.db.prepare("INSERT INTO uploads(id,owner_id,path,content_type,size,object_key,status,created_at,expires_at,committed_at) VALUES(?,?,?,'text/plain',1,?,?,0,1,?)")
      .run(uploadId, f.id, f.root + "/historical-" + n, "synthetic-absent-" + uploadId, n % 2 ? "committed" : "expired", n % 2 ? 1 : null);
  }
  const multipartIds = [];
  for (const state of ["pending", "completing"]) {
    const data = Buffer.from("Local multipart " + state + " 雪");
    const multipart = await (await f.request("/fs/resumable", { method: "POST", bearer: f.credential.value,
      body: { path: f.root + "/multipart-" + state + ".txt", size: data.length, contentType: "text/plain", fingerprint: data.length + ":" + sha256(data) } })).json();
    const response = await fetch(f.base + "/api/v1/fs/resumable/" + multipart.uploadId + "/parts/1", {
      method: "PUT", headers: { authorization: "Bearer " + f.credential.value }, body: data, signal,
    });
    assert.equal(response.status, 200); await response.arrayBuffer();
    if (state === "completing") f.db.prepare("UPDATE uploads SET status='completing' WHERE id=?").run(multipart.uploadId);
    multipartIds.push(multipart.uploadId);
  }
  for (let n = 0; n < 3; n++) {
    const day = new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
    f.db.prepare("INSERT INTO agent_usage(token_id,day,operations,upload_bytes) VALUES(?,?,?,?) ON CONFLICT(token_id,day) DO UPDATE SET operations=excluded.operations,upload_bytes=excluded.upload_bytes")
      .run(f.credential.id, day, 10 + n, 1024 * (n + 1));
  }
  f.db.prepare("UPDATE api_tokens SET label='Browser history and preflight' WHERE id=?").run(f.credential.id);
  for (let n = 10; n < 30; n += 5) f.db.prepare("INSERT INTO operation_metrics(owner_id,minute,route,requests,errors,rejections,duration_ms) VALUES(?,?,'mcp',12,2,1,120)")
    .run(f.id, Math.floor(Date.now() / 60000) - n);
  const retainedPath = f.root + "/retained.txt", retained = f.db.prepare("SELECT * FROM entries WHERE owner_id=? AND path=?").get(f.id, retainedPath);
  const run = await f.client.startRun("Local browser retained run", retainedPath, { inputs: [retainedPath] });
  await f.client.completeRun(run.id);
  f.db.prepare("INSERT INTO recovery(id,owner_id,group_id,reason,path,kind,size,content_type,etag,r2_key,created_at,retained_at,expires_at) VALUES(?,?,?,'version',?,'file',?,'text/plain',?,?,?,?,?)")
    .run("version-" + randomUUID(), f.id, "local-browser-version", retainedPath, retained.size, retained.etag, retained.r2_key, Date.now(), Date.now(), Date.now() + 86400000);
  for (let n = 0; n < 55; n++) f.db.prepare("INSERT INTO object_pins(owner_id,reference_id,object_key,expires_at) VALUES(?,?,?,?)")
    .run(f.id, "a-expired-" + String(n).padStart(3, "0") + randomUUID(), retained.r2_key, Date.now() - 3600000);
  for (let n = 0; n < 52; n++) f.db.prepare("INSERT INTO object_pins(owner_id,reference_id,object_key,expires_at) VALUES(?,?,?,?)")
    .run(f.id, "z-future-" + randomUUID(), retained.r2_key, Date.now() + 3600000);
  const workspace = await f.api("/workspaces", { method: "POST", body: { name: "Local integration workspace" }, status: 201 });
  f.db.prepare("INSERT INTO workspace_members(workspace_id,user_id,role,created_at) VALUES(?,?,'viewer',?)").run(workspace.id, f.other, Date.now());
  await f.request("/fs/mkdir", { method: "POST", workspace: workspace.id, body: { path: "/viewer-readable" } });
  const viewer = f.token(f.other, { permissions: ["read"] });
  const tokenScope = f.db.prepare("SELECT owner_id,path_prefix,permissions FROM api_tokens WHERE id=?").get(viewer.id);
  assert.equal(tokenScope.owner_id, f.other); assert.equal(tokenScope.path_prefix, "/");
  assert.deepEqual(JSON.parse(tokenScope.permissions), ["read"]);
  assertFixtureIdentity(await (await f.request("/whoami", { bearer: viewer.value })).json(), f.other, null, "api-token");
  assertFixtureIdentity(await (await f.request("/whoami", { actor: f.otherSession, workspace: workspace.id })).json(), f.other, workspace.id, "session");
  assertFixtureIdentity(await (await f.request("/whoami", { actor: f.session })).json(), f.id, null, "session");
  assert.equal((await f.api("/workspaces", { actor: f.otherSession })).workspaces.find((w) => w.id === workspace.id)?.role, "viewer");
  assert.equal((await f.api("/workspaces")).workspaces.find((w) => w.id === workspace.id)?.role, "owner");
  await f.request("/fs/list?path=/viewer-readable", { actor: f.otherSession, workspace: workspace.id });
  await f.ops("/search-policy", { actor: f.otherSession, workspace: workspace.id, status: 403 });
  await f.ops("/search-policy", { bearer: viewer.value, status: 403 });
  await f.request("/whoami", { bearer: viewer.value, workspace: workspace.id, status: 403 });
  await f.request("/fs/download?" + new URLSearchParams({ path: retainedPath }), { bearer: viewer.value, status: 404 });
  const cookie = (session) => ({ name: "better-auth.session_token", value: session.slice(session.indexOf("=") + 1), url: f.base, httpOnly: true, sameSite: "Lax" });
  const buildFiles = [];
  function hashBuild(path) {
    const info = lstatSync(path); assert(!info.isSymbolicLink(), "Fixture build contains a symlink");
    if (info.isDirectory()) for (const child of readdirSync(path).sort()) hashBuild(join(path, child));
    else if (info.isFile()) buildFiles.push({ path: relative(resolve("."), path), bytes: info.size, sha256: sha256(readFileSync(path)) });
  }
  hashBuild(resolve("apps/web/dist/client")); hashBuild(resolve("apps/web/dist/server"));
  const buildHashManifest = join(work, "built-assets.sha256.json"), buildHash = sha256(JSON.stringify(buildFiles));
  writeFileSync(buildHashManifest, JSON.stringify({ capturedAt: new Date().toISOString(), buildHash, files: buildFiles }, null, 2), { mode: 0o600, flag: "wx" });
  const manifest = {
    localOnly: true, createdAt: new Date().toISOString(), fixtureOnly, work, state, configPath,
    baseUrl: f.base, previewUrl: "http://localhost:8788", appUrl: f.base + "/app",
    namespace: f.root, userId: f.id, workspaceId: workspace.id, buildHash, buildHashManifest,
    initialNamespace: { kind: "personal", ownerId: f.id, workspaceHeader: null, path: f.root },
    sessionSetup: "Use separate fresh browser profiles for the synthetic owner and viewer. Install only that identity's fixture cookie on localhost:8787; never replace an existing user's cookie. Select personal workspace first. Browser agent/root own profile setup.",
    // Synthetic credentials for this disposable state. Do not print them in logs.
    cookie: cookie(f.session), token: f.credential.value,
    viewer: { userId: f.other, cookie: cookie(f.otherSession), workspaceId: workspace.id, role: "viewer", path: "/viewer-readable", personalReadToken: viewer.value },
    fixtures: { failedEntryId: failed, webhookId: hook, terminalDeliveryId: delivery, pendingUploadId: pending.uploadId, alertId: f.id + "-alert",
      indexScope, continuationFailureId: continuationFailure, pendingMultipartId: multipartIds[0], completingMultipartId: multipartIds[1],
      historyTokenId: f.credential.id, retainedPath, retainedRunId: run.id },
    conflictRecipes: {
      staleReindex: "Preview retainedPath; change search-policy through its real PUT endpoint using the owner token; apply the original reviewed request and expect409. Explicit re-preview is required.",
      abandonEligibility: "Preview pendingMultipartId for abandonment; complete it using POST /api/v1/fs/resumable/:id/complete with {} and the owner token; apply the reviewed IDs and expect not-pending for that ID.",
      terminalEligibility: "Preview terminalDeliveryId; delete it through the real cleanup endpoint in a second owner request; applying the old selection must report no additional deletion. Keep hooks disabled.",
    },
    processes: [{ role: "integration-owner", pid: process.pid }, ...children.flatMap((c) => [{ role: "process-guardian", pid: c.guardianPid }, { role: "wrangler", pid: c.pid }])],
    shutdown: "Signal the integration-owner PID with SIGTERM after the browser closes; it stops its own Workers. State is retained for review.",
  };
  const path = join(work, "browser-fixture.json");
  writeFileSync(path, JSON.stringify(manifest, null, 2), { mode: 0o600, flag: "wx" });
  console.log("Synthetic browser fixture manifest (mode 0600): " + path);
  console.log(JSON.stringify({ localOnly: true, baseUrl: f.base, namespace: f.root, initialNamespace: "personal", workspaceId: workspace.id, buildHash, buildHashManifest, state, ownerPid: process.pid, workerPids: children.map((c) => c.pid) }));
  return path;
}
