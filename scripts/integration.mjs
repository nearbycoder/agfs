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
    "features-smoke",
    "platform-smoke",
    "oauth-smoke",
    "sync-smoke",
    "reliability-smoke",
    "expansion-smoke",
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
  queueDb.close();
  console.log("Cloudflare Queue upload-to-search indexing passed.");
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
