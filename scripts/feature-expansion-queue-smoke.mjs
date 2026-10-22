// Run only after integration.mjs starts its real local Cloudflare Queue consumer.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createFixture, eventually, suite } from "./feature-expansion-fixtures.mjs";
import { AgfsClient } from "../packages/sdk/dist/index.js";

const f = await createFixture("http://localhost:8790"), { db, id, root, client } = f;
const s = suite("Feature queue integration");
// The queue-enabled listener shares the web Worker's APP_URL (8787). Send that
// browser origin while addressing its separate 8790 transport; keep CSRF active.
const ops = (path, options = {}) => f.ops(path, { ...options, bearer: f.credential.value,
  headers: { origin: "http://localhost:8787", ...options.headers } });
const pause = (indexingPaused) => ops("/background", { method: "PUT", body: { indexingPaused, webhooksPaused: true } });
async function scheduled(cron) {
  const response = await fetch(f.base + "/cdn-cgi/local/scheduled?" + new URLSearchParams({ cron }));
  assert.equal(response.status, 200, "Local scheduled turn"); await response.text();
}
const indexed = (entryId, text) => {
  const document = db.prepare("SELECT content FROM search_documents WHERE entry_id=? AND indexed_at>0").get(entryId);
  return document?.content === text && !db.prepare("SELECT 1 FROM index_jobs WHERE entry_id=?").get(entryId);
};

await s.test("#89/#90/#91 read-only POST and previews never dispatch due work; explicit reviewed apply does", async () => {
  // Seed through the same state/R2 on the queue-disabled web Worker. Its pending
  // mutation waitUntil cannot dispatch after unpausing, so it cannot be mistaken
  // for dispatch caused by a subsequent read on the queue-enabled Worker.
  db.prepare("INSERT INTO resource_policies(owner_id,indexing_paused,webhooks_paused) VALUES(?,1,1)").run(id);
  const writer = new AgfsClient({ baseUrl: "http://localhost:8787", token: f.credential.value, retries: 0 });
  await writer.mkdir(root);
  const content = "Real queue integration 雪\n", entry = await writer.upload(root + "/queue.txt", Buffer.from(content), { contentType: "text/plain" });
  assert(db.prepare("SELECT 1 FROM index_jobs WHERE entry_id=?").get(entry.id));
  // A local administrative seed makes work eligible without an HTTP mutation.
  // Then only read operations run: accidental read dispatch becomes observable.
  db.prepare("UPDATE resource_policies SET indexing_paused=0 WHERE owner_id=?").run(id);
  const before = db.prepare("SELECT id,generation,due_at FROM resource_work WHERE owner_id=? ORDER BY kind,id").all(id);
  const auditBefore = db.prepare("SELECT count(*) AS n FROM activity WHERE owner_id=? AND action LIKE 'operations%'").get(id).n;
  await ops("/index", { method: "POST", body: { path: root }, headers: { origin: f.base }, status: 403 });
  await ops("/index", { method: "POST", body: { path: root } });
  await ops("/uploads", { method: "POST", body: { path: root } });
  await ops("/retention/references", { method: "POST", body: { path: root + "/queue.txt" } });
  const preview = await ops("/reindex", { method: "POST", body: { path: root + "/queue.txt" } });
  await new Promise((resolve) => setTimeout(resolve, 500));
  assert.deepEqual(db.prepare("SELECT id,generation,due_at FROM resource_work WHERE owner_id=? ORDER BY kind,id").all(id), before);
  assert.equal(db.prepare("SELECT count(*) AS n FROM activity WHERE owner_id=? AND action LIKE 'operations%'").get(id).n, auditBefore);
  assert(db.prepare("SELECT 1 FROM index_jobs WHERE entry_id=?").get(entry.id));
  await ops("/reindex", { method: "POST", body: { path: root + "/queue.txt", dryRun: false, reviewToken: preview.reviewToken } });
  await eventually(() => indexed(entry.id, content), "Reviewed apply did not dispatch/index real R2 bytes");
  const progress = await ops("/maintenance"); assert(progress.progress.dispatched >= 1);
});

await s.test("#88/#91/#92 real queue honors metadata policy, keeps paused failures and retries selected live work", async () => {
  await pause(true);
  await ops("/search-policy", { method: "PUT", body: { mode: "metadata", maxTextBytes: 0 } });
  const path = root + "/metadata.txt", entry = await client.upload(path, Buffer.from("body must be omitted"), { contentType: "text/plain" });
  db.prepare("UPDATE index_job_status SET attempts=2,last_error='Synthetic source failure',next_attempt=? WHERE entry_id=?").run(Date.now() + 3600000, entry.id);
  assert((await ops("/failures")).results.some((r) => r.id === entry.id));
  const retry = await ops("/failures/retry", { method: "POST", body: { ids: [entry.id] } });
  assert.equal(retry.results[0].status, "retried");
  await new Promise((resolve) => setTimeout(resolve, 300));
  assert(db.prepare("SELECT 1 FROM index_jobs WHERE entry_id=?").get(entry.id));
  assert(!(await ops("/failures")).results.some((r) => r.id === entry.id));
  await pause(false);
  await eventually(() => indexed(entry.id, ""), "Resumed metadata job did not finish without indexed body");
  assert.equal(await client.readText(path), "body must be omitted");
  const diagnostic = await ops("/index", { method: "POST", body: { path } });
  assert.equal(diagnostic.results[0].state, "current"); assert.equal(diagnostic.results[0].contentReason, "metadata-policy");
});

await s.test("scheduled cleanup advances multiple bounded pages while preserving live bytes and active references", async () => {
  // This deliberately tests settled external behavior, not the still-evolving
  // cleanup helper's internal cursor schema or exact per-task implementation.
  await pause(true);
  const at = Date.now(), path = root + "/retained.txt", data = Buffer.from("preserve through cleanup 雪\n");
  const entry = await client.upload(path, data, { contentType: "text/plain" });
  const key = db.prepare("SELECT r2_key FROM entries WHERE id=?").get(entry.id).r2_key;
  const activePin = "active-pin-" + randomUUID(), expiredSnapshot = "expired-snapshot-" + randomUUID();
  db.prepare("INSERT INTO object_pins(owner_id,reference_id,object_key,expires_at) VALUES(?,?,?,?)").run(id, activePin, key, at + 86400000);
  db.prepare("INSERT INTO object_gc(r2_key,created_at) VALUES(?,?) ON CONFLICT(r2_key) DO UPDATE SET created_at=excluded.created_at").run(key, at - 86400000);
  db.prepare("INSERT INTO snapshots(id,owner_id,name,path_prefix,created_at,expires_at,actor_id) VALUES(?,?,?,?,?,?,?)")
    .run(expiredSnapshot, id, "Expired local parent", root, 0, 1, id);
  for (let n = 0; n < 65; n++) db.prepare("INSERT INTO snapshot_entries(snapshot_id,path,entry) VALUES(?,?,?)")
    .run(expiredSnapshot, root + "/expired-child-" + n, "{}");
  db.prepare("INSERT INTO object_pins(owner_id,reference_id,object_key,expires_at) VALUES(?,?,?,1)").run(id, expiredSnapshot, key);
  const oldMinute = Math.floor(at / 60000) - 20 * 1440;
  for (let n = 0; n < 75; n++) db.prepare("INSERT INTO operation_metrics(owner_id,minute,route,requests,errors,rejections,duration_ms) VALUES(?,?,'mcp',1,0,0,1)").run(id, oldMinute - n);
  const countOld = () => db.prepare("SELECT count(*) AS n FROM operation_metrics WHERE owner_id=? AND minute<=?").get(id, oldMinute).n;
  const parent = () => db.prepare("SELECT 1 FROM snapshots WHERE id=?").get(expiredSnapshot);
  const childCount = () => db.prepare("SELECT count(*) AS n FROM snapshot_entries WHERE snapshot_id=?").get(expiredSnapshot).n;
  await scheduled("17 * * * *");
  await eventually(() => countOld() < 75, "Hourly cleanup did not begin bounded metric retirement");
  assert(countOld() > 0, "One turn unexpectedly purged the entire multi-page fixture");
  if (childCount() > 0) assert(parent(), "Snapshot parent removed while children remain");
  let turns = 1;
  // Old fixtures from earlier scripts can also occupy bounded candidate pages.
  // Never expect a single cron to purge the entire shared disposable database.
  while ((countOld() || parent()) && turns < 40) {
    await scheduled("* * * * *"); turns++;
    await new Promise((resolve) => setTimeout(resolve, 200));
    if (childCount() > 0) assert(parent(), "Continuation removed a nonempty snapshot parent");
  }
  assert.equal(countOld(), 0, "Minute continuations failed to finish the old metric pages");
  assert.equal(parent(), undefined, "Minute continuations failed to finish the expired parent");
  assert.equal(childCount(), 0);
  assert(db.prepare("SELECT 1 FROM object_pins WHERE owner_id=? AND reference_id=?").get(id, activePin));
  assert(db.prepare("SELECT 1 FROM entries WHERE id=?").get(entry.id));
  assert.deepEqual(Buffer.from(await (await client.download(path, entry.etag)).arrayBuffer()), data);
  assert(db.prepare("SELECT count(*) AS n FROM operation_metrics WHERE owner_id=? AND minute>?").get(id, oldMinute).n > 0);
  console.log(JSON.stringify({ cleanupContinuationTurns: turns, oldFixtureMetricRows: 75, expiredSnapshotChildren: 65, preservedBytes: data.length }));
});

s.finish({ owner: id, namespace: root });
