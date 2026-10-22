import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
const root = resolve("."),
  work = mkdtempSync(join(tmpdir(), "agfs-integration-")),
  state = join(work, "state"),
  env = { ...process.env, AGFS_TEST_STATE: state };
const config = JSON.parse(readFileSync("apps/web/dist/server/wrangler.json"));
config.main = resolve("apps/web/dist/server/index.js");
config.assets.directory = resolve("apps/web/dist/client");
config.d1_databases[0].migrations_dir = resolve("packages/db/src/migrations");
delete config.configPath;
delete config.userConfigPath;
config.queues = { producers: [], consumers: [] };
config.services = [
  { binding: "CIMD_EGRESS", service: "agfs-integration-cimd" },
];
config.vars = {
  ...config.vars,
  APP_URL: "http://localhost:8787",
  PREVIEW_URL: "http://localhost:8788",
  BETTER_AUTH_SECRET: "local-audit-only-secret-at-least-32-characters",
  GITHUB_CLIENT_ID: "local-test",
  GITHUB_CLIENT_SECRET: "local-test",
  PREVIEW_SIGNING_SECRET: "local-preview-only-secret-at-least-32-characters",
};
// Integration checks have a separate generous limiter; dedicated tests cover rejection.
config.ratelimits = config.ratelimits.map((r) => ({
  ...r,
  simple: { limit: 10000, period: 60 },
}));
const configPath = join(work, "worker.json");
writeFileSync(configPath, JSON.stringify(config));
const wrangler = resolve("apps/web/node_modules/wrangler/bin/wrangler.js");
function run(args) {
  const r = spawnSync(process.execPath, [wrangler, ...args], {
    stdio: "inherit",
    env,
  });
  if (r.status !== 0) throw new Error("Wrangler command failed");
}
run([
  "d1",
  "migrations",
  "apply",
  "agfs-db",
  "--local",
  "--config",
  configPath,
  "--persist-to",
  state,
]);
const dir = join(state, "v3/d1/miniflare-D1DatabaseObject"),
  db = new DatabaseSync(
    join(
      dir,
      readdirSync(dir).find(
        (f) => f.endsWith(".sqlite") && f !== "metadata.sqlite",
      ),
    ),
  );
for (const id of ["alice", "bob"]) {
  db.prepare("INSERT INTO user(id,name,email) VALUES(?,?,?)").run(
    id,
    id,
    id + "@example.test",
  );
  db.prepare(
    "INSERT INTO api_tokens(id,owner_id,label,token_hash,prefix,permissions,created_at,expires_at) VALUES(?,?,?,?,?,?,?,?)",
  ).run(
    "test-" + id,
    id,
    "Local test",
    createHash("sha256")
      .update("agfs_local_test_" + id)
      .digest("hex"),
    "agfs_local",
    JSON.stringify(["read", "write", "delete", "share", "manage"]),
    Date.now(),
    Date.now() + 86400000,
  );
}
db.close();
const previewPath = join(work, "preview.json");
writeFileSync(
  previewPath,
  JSON.stringify({
    name: "agfs-preview-test",
    main: resolve("apps/preview/src/index.ts"),
    compatibility_date: "2026-09-06",
    vars: { PREVIEW_SIGNING_SECRET: config.vars.PREVIEW_SIGNING_SECRET },
    r2_buckets: [{ binding: "FILES_BUCKET", bucket_name: "agfs-files" }],
  }),
);
const children = [];
function launch(file, port) {
  const child = spawn(
    process.execPath,
    [
      wrangler,
      "dev",
      "--config",
      file,
      "--port",
      String(port),
      "--inspector-port",
      String(port + 1000),
      "--local-upstream",
      "localhost:" + port,
      "--persist-to",
      state,
      "--test-scheduled",
    ],
    { env, stdio: ["ignore", "pipe", "pipe"] },
  );
  children.push(child);
  child.stdout.on("data", (b) => {
    if (process.env.AGFS_VERBOSE) process.stdout.write(b);
  });
  child.stderr.on("data", (b) => process.stderr.write(b));
  return child;
}
async function wait(port, child) {
  for (let n = 0; n < 100; n++) {
    if (child.exitCode !== null)
      throw new Error("Worker exited during startup");
    try {
      await fetch("http://localhost:" + port + "/");
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  throw new Error("Worker did not start");
}
try {
  const cimdPath = join(work, "cimd-worker.json"),
    cimdMain = join(work, "cimd-worker.mjs");
  writeFileSync(
    cimdMain,
    `export default {async fetch(request) {
    const target=new URL(request.url).searchParams.get('url');
    if(target!=='https://client.example.com/client.json')return new Response('Missing',{status:404});
    return Response.json({client_id:target,client_name:'CIMD test client',redirect_uris:['http://127.0.0.1:9876/callback'],token_endpoint_auth_method:'none',grant_types:['authorization_code','refresh_token'],response_types:['code'],scope:'openid offline_access agfs:read'}, {headers:{'cache-control':'public,max-age=60'}});
  }};`,
  );
  writeFileSync(
    cimdPath,
    JSON.stringify({
      name: "agfs-integration-cimd",
      main: cimdMain,
      compatibility_date: "2026-09-06",
    }),
  );
  const cimdWorker = launch(cimdPath, 8792);
  await wait(8792, cimdWorker);
  const web = launch(configPath, 8787),
    preview = launch(previewPath, 8788);
  await Promise.all([wait(8787, web), wait(8788, preview)]);
  console.log("Disposable Workers ready; state: " + state);
  for (const script of [
    "security-smoke",
    "security-boundaries-smoke",
    "features-smoke",
    "platform-smoke",
    "oauth-smoke",
    "sync-smoke",
    "reliability-smoke",
    "expansion-smoke",
    "performance-smoke",
    "performance-expansion-smoke",
    "sdk-oauth-smoke",
    "cimd-smoke",
  ]) {
    await new Promise((resolve, reject) => {
      const c = spawn(process.execPath, ["scripts/" + script + ".mjs"], {
        env,
        stdio: "inherit",
      });
      c.on("exit", (code) =>
        code === 0 ? resolve() : reject(new Error(script + " failed")),
      );
      c.on("error", reject);
    });
  }
  // Enable the real local queue consumer after webhook fixtures are disabled.
  // Test-only destinations must never receive an external delivery.
  const queueDb = new DatabaseSync(
    join(
      dir,
      readdirSync(dir).find(
        (f) => f.endsWith(".sqlite") && f !== "metadata.sqlite",
      ),
    ),
  );
  queueDb.exec("PRAGMA busy_timeout=5000");
  queueDb.prepare("UPDATE webhooks SET enabled=0").run();
  config.queues = {
    producers: [
      { binding: "BACKGROUND_QUEUE", queue: "agfs-integration-background" },
    ],
    consumers: [
      {
        queue: "agfs-integration-background",
        max_batch_size: 10,
        max_batch_timeout: 1,
        max_retries: 3,
        dead_letter_queue: "agfs-integration-background-dead",
      },
      {
        queue: "agfs-integration-background-dead",
        max_batch_size: 10,
        max_batch_timeout: 1,
      },
    ],
  };
  const queuePath = join(work, "queue-worker.json");
  writeFileSync(
    queuePath,
    JSON.stringify({ ...config, name: "agfs-integration-queue" }),
  );
  const queueWorker = launch(queuePath, 8790);
  await wait(8790, queueWorker);
  const { AgfsClient } = await import("../packages/sdk/dist/index.js");
  const queueClient = new AgfsClient({
    baseUrl: "http://localhost:8790",
    token: "agfs_local_test_alice",
  });
  const queueFile = "/queue-runtime-" + Date.now() + ".txt";
  await queueClient.upload(queueFile, new Blob(["queued content check"]), {
    contentType: "text/plain",
  });
  let indexed = false;
  for (let n = 0; n < 100; n++) {
    const found = queueDb
      .prepare(
        "SELECT d.content FROM search_documents d JOIN entries e ON e.id=d.entry_id WHERE e.path=? AND e.owner_id='alice'",
      )
      .get(queueFile);
    if (found?.content === "queued content check") {
      indexed = true;
      break;
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  if (!indexed)
    throw new Error("Queue consumer did not index the uploaded content");
  // Invalid UTF-8 may expand during decoding; it must still finish indexing
  // without crossing D1's per-string limit or entering an endless retry loop.
  const invalidEntry = await queueClient.upload(
    "/queue-invalid-utf8-" + Date.now() + ".txt",
    new Uint8Array(700000).fill(255),
    { contentType: "text/plain" },
  );
  let boundedIndex = false;
  for (let n = 0; n < 100; n++) {
    const found = queueDb.prepare(
      "SELECT length(CAST(content AS BLOB)) AS bytes FROM search_documents WHERE entry_id=? AND indexed_at>0 AND NOT EXISTS(SELECT 1 FROM index_jobs WHERE entry_id=?)",
    ).get(invalidEntry.id, invalidEntry.id);
    if (found) {
      if (found.bytes > 1048576) throw new Error("Decoded search content exceeds its byte budget");
      boundedIndex = true;
      break;
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  if (!boundedIndex) throw new Error("Expanded invalid UTF-8 did not finish indexing");

  // This owner has no requests, indexing jobs, or existing alerts. Its disabled
  // hook cannot make an external request, but exhausted deliveries need an alert.
  const healthOwner = "health-only-" + Date.now(), healthHook = healthOwner + "-hook";
  queueDb.prepare("INSERT INTO user(id,name,email) VALUES(?,?,?)").run(
    healthOwner, "Health-only fixture", healthOwner + "@example.test",
  );
  queueDb.prepare("INSERT INTO webhooks(id,owner_id,url,path_prefix,events,secret,enabled,created_at) VALUES(?,?,?,'/','[]','local-fixture',0,?)").run(
    healthHook, healthOwner, "https://example.invalid/disabled-test-hook", Date.now(),
  );
  queueDb.prepare("INSERT INTO webhook_deliveries(id,webhook_id,event_id,payload,attempts,status,next_attempt,created_at) VALUES(?,?,?,'{}',5,'failed',0,?)").run(
    healthHook + "-delivery", healthHook, healthHook + "-event", Date.now(),
  );
  // Exercise the queue-owner projection through its real SQLite triggers. A
  // deferred job remains pending while scheduled health evaluates its new owner.
  const indexingOwner = healthOwner + "-indexing", formerOwner = indexingOwner + "-former";
  const retainedJob = indexingOwner + "-retained", removedJob = indexingOwner + "-removed";
  queueDb.exec("PRAGMA foreign_keys=ON; BEGIN IMMEDIATE");
  try {
    for (const owner of [indexingOwner, formerOwner])
      queueDb.prepare("INSERT INTO user(id,name,email) VALUES(?,?,?)").run(owner, "Indexing health fixture", owner + "@example.test");
    for (const id of [retainedJob, removedJob])
      queueDb.prepare("INSERT INTO entries(id,owner_id,path,name,kind) VALUES(?,?,?,?,'file')").run(id, formerOwner, "/" + id, id);
    queueDb.prepare("DELETE FROM entries WHERE id=?").run(removedJob);
    queueDb.prepare("UPDATE entries SET owner_id=? WHERE id=?").run(indexingOwner, retainedJob);
    queueDb.prepare("UPDATE index_job_status SET next_attempt=? WHERE entry_id=?").run(Date.now() + 3600000, retainedJob);
    queueDb.prepare("INSERT INTO health_thresholds(owner_id,backlog) VALUES(?,1)").run(indexingOwner);
    const projection = queueDb.prepare("SELECT entry_id,owner_id FROM index_job_owners WHERE entry_id IN (?,?)").all(retainedJob, removedJob);
    if (projection.length !== 1 || projection[0].entry_id !== retainedJob || projection[0].owner_id !== indexingOwner)
      throw new Error("Queue-owner projection did not track insertion, deletion, and ownership transfer");
    queueDb.exec("COMMIT");
  } catch (error) {
    queueDb.exec("ROLLBACK");
    throw error;
  }
  const scheduled = await fetch("http://localhost:8790/cdn-cgi/local/scheduled?cron=*+*+*+*+*");
  if (!scheduled.ok) throw new Error("Local health schedule failed: " + scheduled.status);
  await scheduled.text();
  let webhookAlert = false, indexingAlert = false;
  for (let n = 0; n < 50; n++) {
    webhookAlert = !!queueDb.prepare("SELECT 1 FROM health_alerts WHERE owner_id=? AND kind='webhooks' AND resolved_at IS NULL").get(healthOwner);
    indexingAlert = !!queueDb.prepare("SELECT 1 FROM health_alerts WHERE owner_id=? AND kind='indexing' AND resolved_at IS NULL").get(indexingOwner);
    if (webhookAlert && indexingAlert) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  if (!webhookAlert) throw new Error("Webhook-only owner was omitted from health evaluation");
  if (!indexingAlert) throw new Error("Deferred indexing job was omitted from its new owner's health evaluation");
  if (queueDb.prepare("SELECT 1 FROM health_alerts WHERE owner_id=? AND kind='indexing' AND resolved_at IS NULL").get(formerOwner))
    throw new Error("Transferred indexing job generated an alert for its former owner");
  queueDb.close();
  console.log("Cloudflare Queue indexing, decoded-content bounds, webhook-only health, and queue-owner lifecycle checks passed.");
  if (process.env.AGFS_KEEP_TEST_SERVER) {
    writeFileSync(
      "/tmp/agfs-active-integration.json",
      JSON.stringify({ state, configPath, work }),
    );
    console.log("Keeping test servers available for browser verification.");
    await new Promise((resolve) => {
      process.once("SIGINT", resolve);
      process.once("SIGTERM", resolve);
    });
  }
} finally {
  for (const c of children) c.kill("SIGTERM");
}
