import { mkdtempSync, readFileSync, writeFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { createServer } from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import { createOwnedRuntime, integrationFlags } from "./feature-expansion-fixtures.mjs";

// Register cancellation before flags, port probes, migration, startup or seeding.
const runtime = createOwnedRuntime(), databases = new Set();
let work, state;
async function integrate() {
  const { keepServer, fixtureOnly } = integrationFlags(process.env);
  runtime.check();
  work = mkdtempSync(join(tmpdir(), "agfs-integration-"));
  state = join(work, "state");
  const env = { ...process.env, AGFS_TEST_STATE: state, WRANGLER_SEND_METRICS: "false", CI: "1" };
  writeFileSync(join(work, "runtime-owner.json"), JSON.stringify({ ownerPid: process.pid, state, startedAt: new Date().toISOString(), keepServer, fixtureOnly }), { mode: 0o600, flag: "wx" });
  await runtime.run(process.execPath, ["--test", "scripts/feature-expansion-lifecycle.test.mjs"], { env, stdio: "inherit" }, "Isolated harness regressions");
  // Never accidentally verify another process already listening on a shared port.
  const workerPorts = [8787, 8788, 8792, ...(fixtureOnly ? [] : [8790])];
  for (const port of [...workerPorts, ...workerPorts.map((port) => port + 1000)]) {
    await new Promise((accept, reject) => {
      runtime.check();
      const probe = createServer();
      const cancelled = () => { probe.close(() => {}); reject(runtime.signal.reason); };
      runtime.signal.addEventListener("abort", cancelled, { once: true });
      probe.once("error", () => {
        runtime.signal.removeEventListener("abort", cancelled);
        reject(new Error(`Integration port ${port} is already in use; do not stop an unowned process`));
      });
      probe.listen(port, () => probe.close(() => {
        runtime.signal.removeEventListener("abort", cancelled);
        accept();
      }));
    });
  }
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
  async function run(args) {
    await runtime.run(process.execPath, [wrangler, ...args], { stdio: "inherit", env }, "Wrangler migration");
  }
  await run([
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
  databases.add(db);
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
  databases.delete(db);
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
    const child = runtime.launch(
      process.execPath,
      [
        wrangler,
        "dev",
        "--local",
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
      { service: true, label: "Worker on " + port },
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
      runtime.check();
      if (child.exitCode !== null || child.signalCode !== null)
        throw new Error("Worker exited during startup");
      try {
        const response = await fetch("http://localhost:" + port + "/", { signal: AbortSignal.any([runtime.signal, AbortSignal.timeout(2000)]) });
        await response.body?.cancel();
        return;
      } catch {
        await delay(200, undefined, { signal: runtime.signal });
      }
    }
    throw new Error("Worker did not start");
  }
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
  if (!fixtureOnly) {
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
      "feature-expansion-smoke",
      "feature-expansion-clients-smoke",
    ]) {
      await runtime.run(process.execPath, ["scripts/" + script + ".mjs"], { env, stdio: "inherit" }, script);
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
    databases.add(queueDb);
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
      fetch: (input, init) => fetch(input, { ...init, signal: runtime.signal }),
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
      await delay(200, undefined, { signal: runtime.signal });
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
      await delay(200, undefined, { signal: runtime.signal });
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
    const scheduled = await fetch("http://localhost:8790/cdn-cgi/local/scheduled?cron=*+*+*+*+*", { signal: runtime.signal });
    if (!scheduled.ok) throw new Error("Local health schedule failed: " + scheduled.status);
    await scheduled.text();
    let webhookAlert = false, indexingAlert = false;
    for (let n = 0; n < 50; n++) {
      webhookAlert = !!queueDb.prepare("SELECT 1 FROM health_alerts WHERE owner_id=? AND kind='webhooks' AND resolved_at IS NULL").get(healthOwner);
      indexingAlert = !!queueDb.prepare("SELECT 1 FROM health_alerts WHERE owner_id=? AND kind='indexing' AND resolved_at IS NULL").get(indexingOwner);
      if (webhookAlert && indexingAlert) break;
      await delay(100, undefined, { signal: runtime.signal });
    }
    if (!webhookAlert) throw new Error("Webhook-only owner was omitted from health evaluation");
    if (!indexingAlert) throw new Error("Deferred indexing job was omitted from its new owner's health evaluation");
    if (queueDb.prepare("SELECT 1 FROM health_alerts WHERE owner_id=? AND kind='indexing' AND resolved_at IS NULL").get(formerOwner))
      throw new Error("Transferred indexing job generated an alert for its former owner");
    queueDb.close();
    databases.delete(queueDb);
    console.log("Cloudflare Queue indexing, decoded-content bounds, webhook-only health, and queue-owner lifecycle checks passed.");
    await runtime.run(process.execPath, ["scripts/feature-expansion-queue-smoke.mjs"], { env, stdio: "inherit" }, "feature-expansion-queue-smoke");
  }
  if (keepServer) {
    // Dynamic fixture imports read only this harness's freshly migrated state.
    process.env.AGFS_TEST_STATE = state;
    const { prepareBrowserFixture } = await import("./feature-expansion-browser-fixture.mjs");
    await prepareBrowserFixture({ state, configPath, work, children, fixtureOnly, signal: runtime.signal });
    console.log("Keeping test servers available for browser verification.");
    await runtime.wait();
  }
}
try {
  await runtime.guard(integrate());
} catch (error) {
  process.exitCode = runtime.signalName === "SIGINT" ? 130 : runtime.signalName === "SIGTERM" ? 143 : 1;
  console.error(error.message);
} finally {
  try {
    await runtime.shutdown();
    for (const db of databases) db.close();
    if (work) {
      writeFileSync(join(work, "shutdown.json"), JSON.stringify({ ownerPid: process.pid, ownedPids: runtime.pids, outcomes: runtime.outcomes, stoppedAt: new Date().toISOString(), signal: runtime.signalName ?? null, processesStopped: true, stateRetained: state }), { mode: 0o600, flag: "wx" });
      console.log("Owned integration processes stopped; disposable state retained: " + state);
    }
  } catch (error) {
    process.exitCode = 1;
    console.error("Integration shutdown failed: " + error.message);
    if (work) writeFileSync(join(work, "shutdown-failure.json"), JSON.stringify({ ownerPid: process.pid,
      ownedPids: runtime.pids, outcomes: runtime.outcomes, stoppedAt: new Date().toISOString(), signal: runtime.signalName ?? null,
      processesStopped: runtime.cleanupComplete, error: error.message, stateRetained: state }), { mode: 0o600, flag: "wx" });
  } finally {
    runtime.dispose();
  }
}
