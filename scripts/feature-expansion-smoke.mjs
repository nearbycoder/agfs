// Features #88–104 against built local Workers, real SQLite/D1 and R2.
// Browser transformation/layout evidence is separately coordinated; no mock server here.
import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import { assertNoPrivateFields, createFixture, fixtureSigningSecret, sha256, suite } from "./feature-expansion-fixtures.mjs";

const f = await createFixture(), { db, id, other, root, client, request, api, ops } = f;
const s = suite("Feature operations integration");
const jobs = () => db.prepare("SELECT s.* FROM index_job_status s JOIN entries e ON e.id=s.entry_id WHERE e.owner_id=? ORDER BY s.entry_id").all(id);
const activity = () => db.prepare("SELECT count(*) AS n FROM activity WHERE owner_id=? AND action LIKE 'operations%'").get(id).n;
const controlState = () => ({ jobs: jobs(), activity: activity(),
  policy: db.prepare("SELECT * FROM resource_policies WHERE owner_id=?").get(id),
  work: db.prepare("SELECT * FROM resource_work WHERE owner_id=? ORDER BY kind,id").all(id),
  progress: db.prepare("SELECT * FROM resource_owner_progress WHERE owner_id=?").get(id) });
const post = (body, options = {}) => ({ method: "POST", body, ...options });
await client.mkdir(root);
const file = root + "/original.txt", bytes = Buffer.from("Exact local bytes: 雪 🌱\r\nsecond line\n");
const original = await client.upload(file, bytes, { contentType: "text/plain" });

await s.test("#88 content policy validation, revision, metadata mode and owner/workspace isolation", async () => {
  const initial = await ops("/search-policy");
  assert.equal(initial.mode, "content");
  assert.equal(initial.maxTextBytes, 1048576);
  assert.equal(initial.reindexRequired, false);
  const changed = await ops("/search-policy", { method: "PUT", body: { mode: "metadata", maxTextBytes: 0 } });
  assert(changed.revision > initial.revision);
  assert.equal(changed.reindexRequired, true);
  assert.equal((await ops("/search-policy", { actor: f.otherSession })).mode, "content");
  const workspace = await api("/workspaces", post({ name: "Feature integration " + randomUUID() }, { status: 201 }));
  assert.equal((await ops("/search-policy", { workspace: workspace.id })).mode, "content");
  await ops("/search-policy", { method: "PUT", body: { mode: "content", maxTextBytes: 1048577 }, status: 400 });
  assert.equal((await ops("/search-policy")).maxTextBytes, 0);
});

await s.test("all 17 operation families refuse read tokens and subtree manage tokens at root", async () => {
  const reader = f.token(id, { permissions: ["read"] }), subtree = f.token(id, { pathPrefix: root });
  const routes = [
    ["/search-policy", {}], ["/index", post({ path: root })], ["/reindex", post({ path: root })],
    ["/background", {}], ["/failures", {}], ["/failures/retry", post({ ids: [original.id] })], ["/maintenance", {}],
    ["/uploads", post({ path: root })], ["/uploads/abandon", post({ ids: ["missing"] })],
    ["/budgets/history?tokenId=" + reader.id, {}], ["/budgets/preflight", post({ tokenId: reader.id })],
    ["/budgets/batch", { method: "PUT", body: { updates: [{ id: reader.id, paused: false, storageLimit: null, uploadLimit: null, operationLimit: null }] } }],
    ["/budgets/tokens", {}], ["/metrics", {}],
    ["/alerts/missing/acknowledge", { method: "PUT", body: { note: "test" } }],
    ["/alerts/missing/snooze", { method: "PUT", body: { minutes: 1 } }],
    ["/retention/references", post({ path: file })], ["/retention/expiring", {}], ["/webhooks/cleanup", post({ ids: ["missing"] })],
  ];
  const before = controlState();
  for (const bearer of [reader.value, subtree.value])
    for (const [path, options] of routes) await ops(path, { ...options, bearer, status: 403 });
  await ops("/search-policy", { actor: null, status: 401 });
  assert.deepEqual(controlState(), before);
});

let page;
await s.test("#89 literal subtree, bounded candidate pages and owner/filter-bound cursors", async () => {
  const scope = root + "/literal_%";
  for (let n = 0; n < 52; n++) f.entry(scope + "/" + String(n).padStart(3, "0") + ".txt");
  f.entry(root + "/literalXQ/foreign-match.txt");
  f.entry(scope + "/foreign.txt", { owner: other });
  page = await ops("/index", post({ path: scope, state: "all" }));
  assert.equal(page.inspected, 50); assert.equal(page.results.length, 50); assert(page.nextCursor);
  assert(page.results.every((r) => r.path.startsWith(scope + "/") && r.contentReason === "metadata-policy"));
  const next = await ops("/index", post({ path: scope, state: "all", cursor: page.nextCursor }));
  assert.equal(next.results.length, 2); assert.equal(next.nextCursor, null);
  assert.equal(new Set([...page.results, ...next.results].map((r) => r.id)).size, 52);
  const empty = await ops("/index", post({ path: scope, state: "failed" }));
  assert.deepEqual(empty.results, []); assert.equal(empty.inspected, 50); assert(empty.nextCursor);
  await ops("/index", post({ path: scope, state: "failed", cursor: page.nextCursor }, { status: 400 }));
  await ops("/index", post({ path: root, cursor: page.nextCursor }, { status: 400 }));
  await ops("/index", post({ path: scope, cursor: page.nextCursor }, { actor: f.otherSession, status: 400 }));
  const get = await ops("/index?" + new URLSearchParams({ path: scope }));
  assert.deepEqual(get, page);
  assertNoPrivateFields(page);
});

await s.test("read-only POSTs preserve operations state, reject oversized bodies and round-trip 4096-unit Unicode paths", async () => {
  const prefix = "/" + "雪".repeat(4088), longPath = prefix + "/000000";
  assert.equal(longPath.length, 4096);
  for (let n = 0; n < 51; n++) f.entry(prefix + "/" + String(n).padStart(6, "0"));
  const before = controlState();
  const first = await ops("/index", post({ path: prefix }));
  assert.equal(first.results.length, 50); assert(first.nextCursor);
  const payload = { path: prefix, cursor: first.nextCursor };
  assert(Buffer.byteLength(JSON.stringify(payload)) <= 16384);
  assert.equal((await ops("/index", post(payload))).results.length, 1);
  assert.equal((await ops("/index", post({ path: longPath }))).results[0].path, longPath);
  assert.deepEqual((await ops("/uploads", post({ path: longPath }))).results, []);
  assert.equal((await ops("/retention/references", post({ path: longPath }))).path, longPath);
  for (const endpoint of ["/index", "/uploads", "/retention/references"])
    await ops(endpoint, { method: "POST", rawBody: JSON.stringify({ path: "/", padding: "x".repeat(16384) }), status: 413 });
  await ops("/index", { method: "POST", rawBody: "{", status: 400 });
  assert.deepEqual(controlState(), before);
});

await s.test("#90 reviewed reindex applies the exact input page and dry run performs no enqueue", async () => {
  const scope = root + "/literal_%", before = controlState();
  const preview = await ops("/reindex", post({ path: scope }));
  assert.equal(preview.dryRun, true); assert.equal(preview.enqueued, 0); assert.equal(preview.inspected, 50);
  assert.equal(preview.maximumR2Reads, 50); assert(preview.reviewToken.length <= 512);
  assert(preview.reviewExpiresAt > Date.now() && preview.reviewExpiresAt <= Date.now() + 300000);
  assert.deepEqual(controlState(), before);
  const applied = await ops("/reindex", post({ path: scope, dryRun: false, reviewToken: preview.reviewToken }));
  assert.equal(applied.enqueued, 50); assert.equal(applied.reviewToken, null);
  const second = await ops("/reindex", post({ path: scope, cursor: preview.nextCursor }));
  assert.equal(second.results.length, 2);
  await ops("/reindex", post({ path: scope, dryRun: false, reviewToken: second.reviewToken }, { status: 409 }));
  const tail = await ops("/reindex", post({ path: scope, cursor: preview.nextCursor, dryRun: false, reviewToken: second.reviewToken }));
  assert.equal(tail.enqueued, 2);
});

await s.test("#90 missing/tampered/expired/foreign/changed-filter reviews refuse without enqueue", async () => {
  const preview = await ops("/reindex", post({ path: file }));
  const [payload] = preview.reviewToken.split(".");
  const expired = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(payload, "base64url").toString()), expiresAt: Date.now() - 1000 })).toString("base64url");
  const expiredToken = expired + "." + createHmac("sha256", fixtureSigningSecret).update("agfs:operations:reindex:v1:" + expired).digest("base64url");
  const before = controlState();
  for (const body of [
    { path: file }, { path: file, reviewToken: preview.reviewToken.slice(0, -3) + "AAA" },
    { path: file, reviewToken: expiredToken }, { path: root, reviewToken: preview.reviewToken },
    { path: file, failedOnly: true, reviewToken: preview.reviewToken },
  ]) await ops("/reindex", post({ ...body, dryRun: false }, { status: 409 }));
  await ops("/reindex", post({ path: file, dryRun: false, reviewToken: preview.reviewToken }, { actor: f.otherSession, status: 409 }));
  assert.deepEqual(controlState(), before);
});

await s.test("#90 policy, sentinel and empty-plan changes invalidate signed snapshots", async () => {
  const policyReview = await ops("/reindex", post({ path: file }));
  await ops("/search-policy", { method: "PUT", body: { mode: "content", maxTextBytes: 1048576 } });
  let before = jobs();
  await ops("/reindex", post({ path: file, dryRun: false, reviewToken: policyReview.reviewToken }, { status: 409 }));
  assert.deepEqual(jobs(), before);
  const scope = root + "/literal_%", sentinel = await ops("/reindex", post({ path: scope }));
  db.prepare("UPDATE entries SET etag=? WHERE owner_id=? AND path=?").run(sha256("changed sentinel"), id, scope + "/050.txt");
  before = jobs();
  await ops("/reindex", post({ path: scope, dryRun: false, reviewToken: sentinel.reviewToken }, { status: 409 }));
  assert.deepEqual(jobs(), before);
  const emptyPath = root + "/empty-review", empty = await ops("/reindex", post({ path: emptyPath }));
  assert.deepEqual(empty.results, []); assert(empty.reviewToken);
  f.entry(emptyPath + "/new.txt"); before = jobs();
  await ops("/reindex", post({ path: emptyPath, dryRun: false, reviewToken: empty.reviewToken }, { status: 409 }));
  assert.deepEqual(jobs(), before);
});

await s.test("#91 pause/resume preserves queued work and policy isolation", async () => {
  const before = jobs();
  const paused = await ops("/background", { method: "PUT", body: { indexingPaused: true, webhooksPaused: true } });
  assert.equal(paused.maintenanceContinues, true); assert.deepEqual(jobs(), before);
  assert.equal((await ops("/background", { actor: f.otherSession })).indexingPaused, false);
  assert.equal((await ops("/background")).webhooksPaused, true);
  await ops("/background", { method: "PUT", body: { indexingPaused: false, webhooksPaused: false } });
  assert.deepEqual(jobs(), before);
});

await s.test("#92 live historical failure inbox, selected retry, ownership transfer and source lifecycle", async () => {
  const failed = f.entry(root + "/failed.txt"), transferred = f.entry(root + "/transferred.txt"), removed = f.entry(root + "/removed.txt");
  for (const entryId of [failed, transferred, removed])
    db.prepare("UPDATE index_job_status SET attempts=2,last_error='Synthetic retry',next_attempt=? WHERE entry_id=?").run(Date.now() + 3600000, entryId);
  const disabled = f.delivery(f.hook()), foreign = f.delivery(f.hook(other));
  const inbox = await ops("/failures");
  for (const entryId of [failed, transferred, removed, disabled]) assert(inbox.results.some((r) => r.id === entryId));
  assert(!inbox.results.some((r) => r.id === foreign)); assertNoPrivateFields(inbox);
  db.prepare("UPDATE entries SET owner_id=? WHERE id=?").run(other, transferred);
  // The existing entry-update trigger resets attempts when ownership changes.
  // A subsequent failure belongs only to the new owner; the former owner cannot retry it.
  assert.equal(db.prepare("SELECT attempts FROM index_job_status WHERE entry_id=?").get(transferred).attempts, 0);
  db.prepare("UPDATE index_job_status SET attempts=2,last_error='New owner synthetic failure' WHERE entry_id=?").run(transferred);
  db.prepare("DELETE FROM entries WHERE id=?").run(removed);
  const result = await ops("/failures/retry", post({ ids: [failed, transferred, removed, disabled, foreign] }));
  assert.deepEqual(result.results.map((r) => r.status), ["retried", "unavailable", "unavailable", "unavailable", "unavailable"]);
  assert.equal(db.prepare("SELECT attempts FROM index_job_status WHERE entry_id=?").get(failed).attempts, 0);
  assert.equal(db.prepare("SELECT attempts FROM index_job_status WHERE entry_id=?").get(transferred).attempts, 2);
  const after = await ops("/failures");
  assert(!after.results.some((r) => [failed, transferred, removed].includes(r.id)));
  assert(after.results.some((r) => r.id === disabled));
  assert((await ops("/failures", { actor: f.otherSession })).results.some((r) => r.id === transferred));
  await ops("/failures/retry", post({ ids: Array.from({ length: 21 }, () => randomUUID()) }, { status: 400 }));
});

await s.test("#93 maintenance exposes bounded owned lower bounds and no global cursor", async () => {
  const own = await ops("/maintenance"), foreign = await ops("/maintenance", { actor: f.otherSession });
  assert.deepEqual(own.turnLimits, { backgroundCandidates: 50, healthOwners: 100 });
  assert.equal(own.backlogIsLowerBound, true); assert.equal(own.indexing.pendingAtLeast, 50); assert.equal(own.indexing.hasMore, true);
  assert(foreign.indexing.pendingAtLeast < own.indexing.pendingAtLeast);
  assert(!Object.hasOwn(own, "cursor")); assertNoPrivateFields(own);
});

let direct, multipart, budgetToken;
await s.test("#94 actual direct/multipart reservations, byte progress and private inventory", async () => {
  budgetToken = f.token();
  direct = await (await request("/fs/upload-intents", post({ path: root + "/abandon-direct.txt", size: 4, contentType: "text/plain" }, { bearer: budgetToken.value }))).json();
  const data = Buffer.from("multipart progress 雪");
  multipart = await (await request("/fs/resumable", post({ path: root + "/abandon-multipart.txt", size: data.length, contentType: "text/plain", fingerprint: data.length + ":" + sha256(data) }, { bearer: budgetToken.value }))).json();
  const part = await fetch(f.base + "/api/v1/fs/resumable/" + multipart.uploadId + "/parts/1", { method: "PUT", headers: { authorization: "Bearer " + budgetToken.value }, body: data });
  assert.equal(part.status, 200); await part.arrayBuffer();
  const inventory = await ops("/uploads", post({ path: root, status: "active", tokenId: budgetToken.id }));
  const d = inventory.results.find((r) => r.id === direct.uploadId), m = inventory.results.find((r) => r.id === multipart.uploadId);
  assert(d && m); assert.equal(d.uploadedBytes, null); assert.equal(d.multipart, false);
  assert.equal(m.uploadedBytes, data.length); assert.equal(m.reservedBytes, data.length); assert.equal(m.multipart, true);
  assertNoPrivateFields(inventory);
  assert.deepEqual((await ops("/uploads", post({ path: root, tokenId: budgetToken.id, before: 0 }))).results, []);
  assert.deepEqual((await ops("/uploads", post({ path: root }, { actor: f.otherSession }))).results, []);
});

await s.test("#95 abandonment preview/apply keeps daily usage, completing uploads and late PUT refusal", async () => {
  const usage = () => db.prepare("SELECT * FROM agent_usage WHERE token_id=? ORDER BY day").all(budgetToken.id);
  const beforeUsage = usage(), ids = [direct.uploadId, multipart.uploadId, "missing"];
  const preview = await ops("/uploads/abandon", post({ ids }));
  assert.equal(preview.dryRun, true); assert.equal(preview.dailyUploadBudgetRefunded, false);
  assert.deepEqual(preview.results.map((r) => r.status), ["would-abandon", "would-abandon", "unavailable"]);
  db.prepare("UPDATE uploads SET status='completing' WHERE id=?").run(multipart.uploadId);
  const applied = await ops("/uploads/abandon", post({ ids, dryRun: false }));
  assert.deepEqual(applied.results.map((r) => r.status), ["abandoned", "not-pending", "unavailable"]);
  assert.deepEqual(usage(), beforeUsage);
  assert.equal(db.prepare("SELECT status FROM uploads WHERE id=?").get(multipart.uploadId).status, "completing");
  const late = await fetch(f.base + "/api/v1/fs/uploads/" + direct.uploadId + "/blob", { method: "PUT", headers: direct.headers, body: Buffer.from("late") });
  assert.equal(late.status, 404); await late.arrayBuffer();
  await request("/fs/uploads/" + direct.uploadId + "/commit", post({ etag: "late" }, { status: 409 }));
  assert.equal((await ops("/uploads/abandon", post({ ids: [direct.uploadId], dryRun: false }))).results[0].status, "already-abandoned");
  await ops("/uploads/abandon", post({ ids: Array.from({ length: 21 }, () => randomUUID()) }, { status: 400 }));
});

await s.test("#94 empty filtered reservation pages still advance and bind filters/owner", async () => {
  for (let n = 0; n < 51; n++) {
    const uploadId = "seed-" + randomUUID();
    db.prepare("INSERT INTO uploads(id,owner_id,path,content_type,size,object_key,status,created_at,expires_at) VALUES(?,?,?,'text/plain',1,?,'expired',0,1)")
      .run(uploadId, id, root + "/old-" + n, "synthetic-absent-" + uploadId);
  }
  const first = await ops("/uploads", post({ path: root, status: "active" }));
  assert.equal(first.inspected, 50); assert.deepEqual(first.results, []); assert(first.nextCursor);
  const next = await ops("/uploads", post({ path: root, status: "active", cursor: first.nextCursor }));
  assert(next.results.some((r) => r.id === multipart.uploadId));
  await ops("/uploads", post({ path: root, status: "expired", cursor: first.nextCursor }, { status: 400 }));
  await ops("/uploads", post({ path: root, cursor: first.nextCursor }, { actor: f.otherSession, status: 400 }));
});

await s.test("#96 UTC history is token/owner bounded and validates retention window", async () => {
  const today = new Date().toISOString().slice(0, 10), old = new Date(Date.now() - 100 * 86400000).toISOString().slice(0, 10);
  db.prepare("INSERT OR REPLACE INTO agent_usage(token_id,day,operations,upload_bytes) VALUES(?,?,7,11)").run(budgetToken.id, today);
  db.prepare("INSERT OR REPLACE INTO agent_usage(token_id,day,operations,upload_bytes) VALUES(?,?,999,999)").run(budgetToken.id, old);
  const history = await ops("/budgets/history?" + new URLSearchParams({ tokenId: budgetToken.id, days: "1" }));
  assert.equal(history.timezone, "UTC"); assert.equal(history.from, today); assert.equal(history.through, today);
  assert.deepEqual(history.results, [{ day: today, operations: 7, uploadBytes: 11 }]);
  await ops("/budgets/history?tokenId=" + budgetToken.id, { actor: f.otherSession, status: 404 });
  await ops("/budgets/history?tokenId=" + budgetToken.id + "&days=91", { status: 400 });
});

await s.test("#97 preflight counts completing reservations, zero/null limits and does not reserve", async () => {
  await ops("/budgets/batch", { method: "PUT", body: { updates: [{ id: budgetToken.id, paused: false, operationLimit: 7, uploadLimit: 11, storageLimit: 0 }] } });
  const before = db.prepare("SELECT id,status,size FROM uploads WHERE token_id=? ORDER BY id").all(budgetToken.id);
  const preflight = await ops("/budgets/preflight", post({ tokenId: budgetToken.id, operations: 1, uploadBytes: 1, storageBytes: 1 }));
  assert.equal(preflight.advisory, true); assert.equal(preflight.allowedByAgentBudget, false);
  assert.deepEqual(preflight.blockers, ["operations", "uploadBytes", "storageBytes"]);
  assert.equal(preflight.used.reservedBytes, Buffer.byteLength("multipart progress 雪"));
  assert.equal(preflight.remaining.storageBytes, 0);
  assert.deepEqual(db.prepare("SELECT id,status,size FROM uploads WHERE token_id=? ORDER BY id").all(budgetToken.id), before);
  await ops("/budgets/preflight", post({ tokenId: budgetToken.id }, { actor: f.otherSession, status: 404 }));
});

await s.test("#98 batch ownership guard is all-or-none; bounded selector contains metadata only", async () => {
  const update = (tokenId, paused = false) => ({ id: tokenId, paused, operationLimit: null, uploadLimit: null, storageLimit: null });
  const before = db.prepare("SELECT paused,operation_limit,storage_limit FROM api_tokens WHERE id=?").get(budgetToken.id);
  await ops("/budgets/batch", { method: "PUT", body: { updates: [update(budgetToken.id, true), update(f.otherCredential.id)] }, status: 409 });
  assert.deepEqual(db.prepare("SELECT paused,operation_limit,storage_limit FROM api_tokens WHERE id=?").get(budgetToken.id), before);
  const moved = f.token(); db.prepare("UPDATE api_tokens SET owner_id=? WHERE id=?").run(other, moved.id);
  await ops("/budgets/batch", { method: "PUT", body: { updates: [update(budgetToken.id), update(moved.id)] }, status: 409 });
  assert.deepEqual(db.prepare("SELECT paused,operation_limit,storage_limit FROM api_tokens WHERE id=?").get(budgetToken.id), before);
  assert.deepEqual((await ops("/budgets/batch", { method: "PUT", body: { updates: [update(budgetToken.id)] } })).updated, [budgetToken.id]);
  assert.equal((await ops("/budgets/preflight", post({ tokenId: budgetToken.id }))).remaining.operations, null);
  for (let n = 0; n < 51; n++) f.token();
  const first = await ops("/budgets/tokens"); assert.equal(first.results.length, 50); assert(first.nextCursor);
  assertNoPrivateFields(first);
  assert.deepEqual(Object.keys(first.results[0]).sort(), ["id", "label", "operationLimit", "pathPrefix", "paused", "storageLimit", "uploadLimit"].sort());
  const second = await ops("/budgets/tokens?" + new URLSearchParams({ cursor: first.nextCursor }));
  assert(second.results.length > 0 && second.results.length <= 50);
  assert(!second.results.some((r) => first.results.some((p) => p.id === r.id)));
  await ops("/budgets/tokens?" + new URLSearchParams({ cursor: first.nextCursor }), { actor: f.otherSession, status: 400 });
  await ops("/budgets/batch", { method: "PUT", body: { updates: [update(budgetToken.id), update(budgetToken.id)] }, status: 400 });
});

await s.test("#99 metrics zero-fill, aggregate exact elapsed latency and reject oversized windows", async () => {
  const minute = Math.floor(Date.now() / 60000) - 20;
  db.prepare("INSERT INTO operation_metrics(owner_id,minute,route,requests,errors,rejections,duration_ms) VALUES(?,?,'mcp',4,1,2,28)").run(id, minute);
  db.prepare("INSERT INTO operation_metrics(owner_id,minute,route,requests,errors,rejections,duration_ms) VALUES(?,?,'mcp',999,999,999,999)").run(other, minute);
  const metrics = await ops("/metrics?hours=1&bucketMinutes=5&route=mcp");
  assert.equal(metrics.results.length, 12);
  assert.equal(metrics.results.reduce((n, r) => n + r.requests, 0), 4);
  const used = metrics.results.find((r) => r.requests); assert.equal(used.averageMs, 7); assert.equal(used.errors, 1); assert.equal(used.rejections, 2);
  assert(metrics.results.some((r) => !r.requests && r.averageMs === null));
  assert.equal((await ops("/metrics?hours=168&bucketMinutes=60")).results.length, 168);
  await ops("/metrics?hours=168&bucketMinutes=5", { status: 400 });
});

await s.test("#100/#101 alert acknowledgement and snooze remain separate from resolution and ownership", async () => {
  const alert = "alert-" + randomUUID();
  db.prepare("INSERT INTO health_alerts(id,owner_id,kind,message,created_at) VALUES(?,?,'indexing','Synthetic fixture alert',?)").run(alert, id, Date.now());
  await ops("/alerts/" + alert + "/acknowledge", { method: "PUT", body: { note: " reviewed locally " } });
  await ops("/alerts/" + alert + "/snooze", { method: "PUT", body: { minutes: 5 } });
  const health = await api("/health"), row = health.alerts.find((r) => r.id === alert);
  assert.equal(row.note, "reviewed locally"); assert.equal(row.acknowledgedBy, id); assert(row.acknowledgedAt); assert(row.snoozedUntil > Date.now());
  assert.equal(row.visible, 0); assert.equal(db.prepare("SELECT resolved_at FROM health_alerts WHERE id=?").get(alert).resolved_at, null);
  await ops("/alerts/" + alert + "/acknowledge", { method: "DELETE" });
  const cleared = await ops("/alerts/" + alert + "/snooze", { method: "PUT", body: { minutes: 0 } });
  assert.equal(cleared.snoozedUntil, null); assert.equal(cleared.evaluationContinues, true);
  assert.equal((await api("/health")).alerts.find((r) => r.id === alert).visible, 1);
  await ops("/alerts/" + alert + "/acknowledge", { method: "PUT", body: { note: "no" }, actor: f.otherSession, status: 404 });
  await ops("/alerts/" + alert + "/snooze", { method: "PUT", body: { minutes: 1 }, actor: f.otherSession, status: 404 });
  await ops("/alerts/" + alert + "/acknowledge", { method: "PUT", body: { note: "x".repeat(501) }, status: 400 });
  await ops("/alerts/" + alert + "/snooze", { method: "PUT", body: { minutes: 10081 }, status: 400 });
});

await s.test("#102 retention references report actual live/snapshot pins without object keys", async () => {
  const snap = await api("/snapshots", post({ name: "Local feature snapshot", path: root, days: 1 }, { status: 201 }));
  const refs = await ops("/retention/references", post({ path: file }));
  assert(refs.results.some((r) => r.kind === "live" && r.referenceId === original.id));
  assert(refs.results.some((r) => r.kind === "snapshot" && r.referenceId === snap.id));
  assert.equal(refs.etag, original.etag); assertNoPrivateFields(refs);
  await ops("/retention/references", post({ path: file }, { actor: f.otherSession, status: 404 }));
  const key = db.prepare("SELECT r2_key FROM entries WHERE id=?").get(original.id).r2_key;
  for (let n = 0; n < 55; n++) db.prepare("INSERT INTO object_pins(owner_id,reference_id,object_key,expires_at) VALUES(?,?,?,?)")
    .run(id, "a-expired-" + String(n).padStart(3, "0") + randomUUID(), key, Date.now() - 3600000);
  const first = await ops("/retention/references", post({ path: file }));
  assert(first.nextCursor); assert(!first.results.some((r) => r.referenceId.startsWith("a-expired-")));
  const next = await ops("/retention/references", post({ path: file, cursor: first.nextCursor }));
  assert(next.results.some((r) => r.referenceId === snap.id));
  await ops("/retention/references", post({ path: root + "/different.txt", cursor: first.nextCursor }, { status: 400 }));
});

await s.test("#103 expiring pins maintain a fixed cursor window and owned 50-row pages", async () => {
  const key = db.prepare("SELECT r2_key FROM entries WHERE id=?").get(original.id).r2_key, expiry = Date.now() + 3600000;
  for (let n = 0; n < 52; n++) db.prepare("INSERT INTO object_pins(owner_id,reference_id,object_key,expires_at) VALUES(?,?,?,?)")
    .run(id, "future-" + randomUUID(), key, expiry);
  const first = await ops("/retention/expiring?days=1");
  assert.equal(first.results.length, 50); assert(first.nextCursor); assertNoPrivateFields(first);
  const next = await ops("/retention/expiring?" + new URLSearchParams({ days: "1", cursor: first.nextCursor }));
  assert.equal(next.from, first.from); assert.equal(next.through, first.through); assert(next.results.length >= 2);
  assert(!next.results.some((r) => first.results.some((p) => p.referenceId === r.referenceId)));
  assert(first.results.every((r) => r.bytes === bytes.length));
  await ops("/retention/expiring?" + new URLSearchParams({ days: "2", cursor: first.nextCursor }), { status: 400 });
  await ops("/retention/expiring?" + new URLSearchParams({ days: "1", cursor: first.nextCursor }), { actor: f.otherSession, status: 400 });
});

await s.test("#104 terminal history preview/delete protects active/foreign rows and retires failures", async () => {
  const hook = f.hook(), delivered = f.delivery(hook, "delivered"), failed = f.delivery(hook), pending = f.delivery(hook, "pending"), sending = f.delivery(hook, "sending"), foreign = f.delivery(f.hook(other));
  const ids = [delivered, failed, pending, sending, foreign], before = db.prepare("SELECT id FROM webhook_deliveries WHERE webhook_id=? ORDER BY id").all(hook);
  const preview = await ops("/webhooks/cleanup", post({ ids }));
  assert.equal(preview.dryRun, true); assert.deepEqual(preview.deleted, []);
  assert.deepEqual(preview.eligible.map((r) => r.id).sort(), [delivered, failed].sort());
  assert.equal(preview.payloadBytes, 2 * Buffer.byteLength('{"local":"雪"}')); assertNoPrivateFields(preview);
  assert.deepEqual(db.prepare("SELECT id FROM webhook_deliveries WHERE webhook_id=? ORDER BY id").all(hook), before);
  const applied = await ops("/webhooks/cleanup", post({ ids, dryRun: false }));
  assert.deepEqual(applied.deleted.sort(), [delivered, failed].sort());
  for (const keep of [pending, sending, foreign]) assert(db.prepare("SELECT 1 FROM webhook_deliveries WHERE id=?").get(keep));
  assert(!(await ops("/failures")).results.some((r) => r.id === failed));
  assert.equal((await ops("/failures/retry", post({ ids: [failed] }))).results[0].status, "unavailable");
  await ops("/webhooks/cleanup", post({ ids: Array.from({ length: 51 }, () => randomUUID()) }, { status: 400 }));
});

assert.deepEqual(Buffer.from(await (await client.download(file, original.etag)).arrayBuffer()), bytes);
// Keep metadata-only synthetic candidates out of the later real queue phase.
for (const actor of [f.session, f.otherSession]) await ops("/background", { method: "PUT", actor, body: { indexingPaused: true, webhooksPaused: true } });
s.finish({ operationRequests: f.requestCount, owner: id, namespace: root });
