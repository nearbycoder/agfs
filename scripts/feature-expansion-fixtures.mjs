// Local-only helpers. Never import this fixture into application code.
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { fileURLToPath } from "node:url";

export const fixtureSigningSecret = "local-audit-only-secret-at-least-32-characters";
export const sha256 = (value) => createHash("sha256").update(value).digest("hex");

export function integrationFlags(env) {
  const keepServer = env.AGFS_KEEP_TEST_SERVER === "1", fixtureOnly = env.AGFS_FIXTURE_ONLY === "1";
  if (fixtureOnly && !keepServer) throw new Error("AGFS_FIXTURE_ONLY requires explicit AGFS_KEEP_TEST_SERVER=1 ownership");
  return { keepServer, fixtureOnly };
}

// A Linux child-subreaper owns every command tree until it has reaped it. The
// parent sends stop messages over its private pipe, never signals a saved PGID.
// Guardian loss fails closed: no numeric-PID/group fallback can hit a new owner.
export function createOwnedRuntime({ graceMs = 5000, killMs = 2000, spawnGuardian = spawn } = {}) {
  if (process.platform !== "linux") throw new Error("Integration process ownership requires Linux pidfds and subreaping");
  const controller = new AbortController(), records = [];
  let closing = false, shutdownPromise, signalName, failure;
  const interrupted = new Promise((_, reject) => {
    controller.signal.addEventListener("abort", () => reject(controller.signal.reason), { once: true });
  });
  interrupted.catch(() => {});
  function abort(reason) { if (!controller.signal.aborted) controller.abort(reason); }
  function fail(error) {
    failure ??= error;
    abort(failure);
    void shutdown().catch(() => {});
  }
  function check() {
    if (failure) throw failure;
    controller.signal.throwIfAborted();
    if (closing) throw new Error("Integration runtime is closing");
  }
  function stop(record) {
    if (record.stopSent || record.closed || record.guardianExited) return;
    record.stopSent = true;
    record.guardian.stdin.end('{"type":"stop"}\n');
  }
  function launch(command, args, options = {}, { service = false, label = command } = {}) {
    check();
    const stdio = options.stdio ?? "pipe";
    const out = Array.isArray(stdio) ? stdio[1] : stdio, err = Array.isArray(stdio) ? stdio[2] : stdio;
    const guardian = spawnGuardian("python3", [fileURLToPath(new URL("./feature-expansion-process-guardian.py", import.meta.url)), String(graceMs), String(killMs)],
      { ...options, detached: true, stdio: ["pipe", out, err, "pipe"] });
    const child = new EventEmitter();
    Object.assign(child, { pid: undefined, guardianPid: guardian.pid, stdout: guardian.stdout, stderr: guardian.stderr, exitCode: null, signalCode: null });
    const record = { guardian, child, label, closed: false, stopped: false, stopSent: false, guardianExited: false, error: null, exited: false };
    records.push(record);
    function childError(error) {
      record.error ??= error;
      // Preserve EventEmitter error semantics without allowing an unhandled error.
      if (child.listenerCount("error")) child.emit("error", error);
      fail(error);
    }
    function cleanupLost() {
      if (record.proofLost) return;
      record.proofLost = true;
      const error = new Error(`${label}: guardian ownership/cleanup proof lost; refusing numeric PID/group signals`);
      record.error ??= error;
      fail(error);
      guardian.stdout?.destroy(); guardian.stderr?.destroy(); guardian.stdio[3]?.destroy();
    }
    guardian.once("error", childError);
    guardian.stdin.on("error", () => { if (!record.stopped) cleanupLost(); });
    guardian.once("exit", (code) => {
      record.guardianExited = true;
      // Telemetry can already be in the pipe when exit arrives. Drain it before
      // judging its final proof; actual command exit is emitted by that channel.
      if (code !== 0 && !record.error) childError(new Error(`${label}: guardian exited ${code}`));
    });
    let buffer = "";
    guardian.stdio[3].setEncoding("utf8");
    guardian.stdio[3].on("data", (chunk) => {
      buffer += chunk;
      if (buffer.length > 65536) return cleanupLost();
      let end;
      while ((end = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
        let message;
        try { message = JSON.parse(line); } catch { cleanupLost(); return; }
        if (message.type === "spawn") { child.pid = message.pid; child.emit("spawn"); }
        else if (message.type === "exit") {
          record.exited = true; child.exitCode = message.code; child.signalCode = message.signal;
          child.terminationSignals = Array.isArray(message.terminationSignals) ? message.terminationSignals : [];
          // Wrangler's wrapper reports 128+SIGTERM instead of a signal status.
          // Accept only requested teardown with proof that the guardian actually
          // signaled this pinned command. Late exit7 and unsignaled143 still fail.
          const expectedTermExit = record.stopSent && message.code === 143 && message.signal === null && child.terminationSignals.includes("SIGTERM");
          // Set failure before exposing exit to consumers. Descendant-held pipes
          // cannot delay refusal of later work or turn a crash into success.
          if (service && (!record.stopSent || (message.code !== null && message.code !== 0 && !expectedTermExit)))
            fail(new Error(`${label} exited unexpectedly (${message.code ?? message.signal})`));
          child.emit("exit", message.code, message.signal);
        } else if (message.type === "spawn-error" || message.type === "failure") {
          childError(Object.assign(new Error(`${label}: ${message.code ?? "guardian"}: ${message.error}`), { code: message.code }));
        } else if (message.type === "stopped" && message.childrenReaped === true) record.stopped = true;
        else if (message.type !== "guardian") cleanupLost();
      }
    });
    guardian.stdio[3].once("end", () => { if (!record.stopped) cleanupLost(); });
    guardian.stdio[3].once("close", () => { if (!record.stopped) cleanupLost(); });
    guardian.stdio[3].on("error", cleanupLost);
    record.done = new Promise((resolve) => {
      guardian.once("close", () => {
        record.closed = true;
        if (!record.stopped && !record.error) cleanupLost();
        child.emit("close", child.exitCode, child.signalCode);
        resolve();
      });
    });
    guardian.stdin.write(JSON.stringify({ type: "start", command, args }) + "\n");
    return child;
  }
  async function run(command, args, options = {}, label = command) {
    const child = launch(command, args, options, { label });
    const record = records.find((record) => record.child === child);
    await guard(record.done);
    if (record.error) throw record.error;
    if (!record.exited || child.exitCode !== 0) throw new Error(`${label} failed (${child.exitCode ?? child.signalCode})`);
  }
  function guard(promise) { return Promise.race([promise, interrupted]); }
  function shutdown() {
    if (shutdownPromise) return shutdownPromise;
    closing = true;
    abort(failure ?? new Error("Integration runtime is stopping"));
    shutdownPromise = (async () => {
      for (const record of records) stop(record);
      let timer;
      try {
        await Promise.race([
          Promise.all(records.map((record) => record.done)),
          new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("Guardian cleanup deadline exceeded; refusing numeric PID/group signals")), graceMs + killMs + 3000); }),
        ]);
      } finally { clearTimeout(timer); }
      const unproved = records.filter((record) => !record.stopped || !record.closed);
      if (unproved.length) throw new Error("Owned descendant cleanup unproved: " + unproved.map((record) => record.label).join(","));
      // Cleanup success must not erase an already-observed service failure.
      if (failure) throw failure;
    })();
    return shutdownPromise;
  }
  const handlers = Object.fromEntries(["SIGINT", "SIGTERM"].map((name) => [name, () => {
    signalName ??= name;
    abort(new Error(`Integration interrupted by ${name}`));
    void shutdown().catch(() => {});
  }]));
  for (const [name, handler] of Object.entries(handlers)) process.on(name, handler);
  return {
    launch, run, guard, check, shutdown, signal: controller.signal,
    get signalName() { return signalName; },
    get failure() { return failure; },
    get cleanupComplete() { return records.every((record) => record.stopped && record.closed); },
    get pids() { return records.flatMap((record) => [record.guardian.pid, record.child.pid]).filter(Boolean); },
    get outcomes() { return records.map(({ guardian, child, label, closed, stopped, error }) => ({
      label, guardianPid: guardian.pid, commandPid: child.pid, exitCode: child.exitCode, signal: child.signalCode,
      terminationSignals: child.terminationSignals ?? [], guardianClosed: closed, childrenReaped: stopped, error: error?.message ?? null,
    })); },
    wait: () => interrupted,
    dispose() { for (const [name, handler] of Object.entries(handlers)) process.removeListener(name, handler); },
  };
}

export function requirePythonAssertions() {
  execFileSync("python3", ["-c", "import sys\nif sys.flags.optimize:\n    raise SystemExit('Feature integration refuses optimized Python; assertions must remain enabled')"],
    { stdio: ["ignore", "pipe", "pipe"], timeout: 10000 });
}

export function assertUnchangedInventoryDiff(rows, entries) {
  assert.equal(rows.length, entries.length, "Offline diff must return every captured entry exactly once");
  assert.deepEqual(rows.map((row) => row.path).sort(), entries.map((entry) => entry.path).sort(), "Offline diff returned missing/duplicate/unexpected paths");
  for (const row of rows) {
    const expected = entries.find((entry) => entry.path === row.path);
    assert.equal(row.status, "unchanged");
    assert.deepEqual(row.before, expected, "Offline diff before metadata");
    assert.deepEqual(row.after, expected, "Offline diff after metadata");
  }
}

export function assertFixtureIdentity(identity, actorId, workspaceId, authSource) {
  assert.equal(identity.user?.id, actorId, "Fixture credential actor differs from its manifest");
  assert.equal(identity.workspaceId, workspaceId, "Fixture credential namespace differs from its manifest");
  assert.equal(identity.authSource, authSource, "Fixture credential authentication source");
}

export function suite(label) {
  const cases = [];
  return {
    async test(name, work) {
      await work();
      cases.push(name);
      console.log(`${label}: PASS ${name}`);
    },
    finish(extra = {}) {
      const result = { suite: label, passed: cases.length, cases, ...extra };
      console.log(JSON.stringify(result));
      return result;
    },
  };
}

export async function createFixture(base = "http://localhost:8787", { signal } = {}) {
  signal?.throwIfAborted();
  assert(process.env.AGFS_TEST_STATE, "Use integration.mjs with its disposable local state");
  const url = new URL(base);
  assert(url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname), "Local Workers only");
  const { cookie, database: db } = await import("./platform-fixtures.mjs");
  const { AgfsClient } = await import("../packages/sdk/dist/index.js");
  signal?.throwIfAborted();
  db.exec("PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000");
  const id = "feature-" + randomUUID(), other = id + "-other", root = "/" + id;
  for (const owner of [id, other])
    db.prepare("INSERT INTO user(id,name,email) VALUES(?,?,?)").run(owner, "Local integration fixture", owner + "@example.test");
  function token(owner = id, { permissions = ["read", "write", "delete", "share", "manage"], pathPrefix = "/", tokenId = "test-" + randomUUID() } = {}) {
    signal?.throwIfAborted();
    const value = "agfs_fixture_" + randomUUID();
    db.prepare("INSERT INTO api_tokens(id,owner_id,label,token_hash,prefix,permissions,path_prefix,created_at,expires_at) VALUES(?,?,?,?,?,?,?,?,?)")
      .run(tokenId, owner, "Local feature fixture", sha256(value), "agfs_fixture", JSON.stringify(permissions), pathPrefix, Date.now(), Date.now() + 86400000);
    return { id: tokenId, value };
  }
  const credential = token(), otherCredential = token(other), session = cookie(id), otherSession = cookie(other);
  const transport = signal ? { fetch: (input, init) => fetch(input, { ...init, signal }) } : {};
  const client = new AgfsClient({ baseUrl: base, token: credential.value, retries: 0, ...transport });
  const otherClient = new AgfsClient({ baseUrl: base, token: otherCredential.value, retries: 0, ...transport });
  let requests = 0;
  async function request(path, { method = "GET", body, rawBody, status = 200, actor = session, bearer, workspace, headers = {} } = {}) {
    signal?.throwIfAborted();
    requests++;
    const response = await fetch(base + "/api/v1" + path, {
      method, redirect: "error", signal,
      headers: { ...(bearer ? { authorization: "Bearer " + bearer } : actor ? { cookie: actor } : {}),
        origin: base, ...(body === undefined && rawBody === undefined ? {} : { "content-type": "application/json" }),
        ...(workspace ? { "x-agfs-workspace": workspace } : {}), ...headers },
      body: rawBody ?? (body === undefined ? undefined : JSON.stringify(body)),
    });
    if (response.status !== status) {
      const payload = await response.clone().json().catch(() => null);
      // Never dump capability/token response bodies when an expectation fails.
      const error = typeof payload?.error === "string" ? payload.error.slice(0, 300) : "non-error response body omitted";
      assert.fail(`${method} ${path.split("?")[0]} expected ${status}, got ${response.status}: ${error}`);
    }
    return response;
  }
  const api = async (path, options) => (await request("/platform" + path, options)).json();
  const ops = async (path, options) => {
    const response = await request("/platform/operations" + path, options);
    if (response.ok) assert.match(response.headers.get("cache-control") ?? "", /private, no-store/);
    return response.json();
  };
  function entry(path, { owner = id, kind = "file", entryId = "entry-" + randomUUID(), key = null, size = 1 } = {}) {
    signal?.throwIfAborted();
    db.prepare("INSERT INTO entries(id,owner_id,parent_path,path,name,kind,size,content_type,etag,r2_key) VALUES(?,?,?,?,?,?,?,?,?,?)")
      .run(entryId, owner, path.slice(0, path.lastIndexOf("/")) || "/", path, path.slice(path.lastIndexOf("/") + 1), kind,
        kind === "file" ? size : null, kind === "file" ? "text/plain" : null, kind === "file" ? sha256(path) : null, key);
    return entryId;
  }
  function hook(owner = id) {
    signal?.throwIfAborted();
    const hookId = "hook-" + randomUUID();
    // Always disabled, including while the queue Worker runs. No network destination is contacted.
    db.prepare("INSERT INTO webhooks(id,owner_id,url,path_prefix,events,secret,enabled,created_at) VALUES(?,?,?,'/','[]','synthetic-fixture-only',0,?)")
      .run(hookId, owner, "https://example.invalid/disabled-integration", Date.now());
    return hookId;
  }
  function delivery(hookId, status = "failed", payload = '{"local":"雪"}') {
    signal?.throwIfAborted();
    const deliveryId = "delivery-" + randomUUID();
    db.prepare("INSERT INTO webhook_deliveries(id,webhook_id,event_id,payload,attempts,status,next_attempt,last_error,created_at) VALUES(?,?,?,?,?,?,?,?,?)")
      .run(deliveryId, hookId, "event-" + randomUUID(), payload, status === "failed" ? 5 : 0, status, Date.now(), status === "failed" ? "Synthetic historical failure" : null, Date.now());
    return deliveryId;
  }
  function tracedClient(value = credential.value) {
    const calls = [];
    return { calls, client: new AgfsClient({ baseUrl: base, token: value, retries: 0, fetch: async (input, init) => {
      const target = new URL(typeof input === "string" ? input : input.url ?? String(input));
      assert.equal(target.origin, base, "Client credentials must remain on the local origin");
      const authorization = new Headers(init?.headers).get("authorization");
      if (authorization) assert(authorization === "Bearer " + value, "Cross-client credential isolation");
      calls.push({ method: init?.method ?? "GET", path: target.pathname, query: target.search, range: new Headers(init?.headers).get("range") });
      return fetch(input, init);
    } }) };
  }
  return { id, other, root, base, db, token, credential, otherCredential, session, otherSession, client, otherClient,
    request, api, ops, entry, hook, delivery, tracedClient, get requestCount() { return requests; } };
}

export function assertNoPrivateFields(value) {
  const forbidden = /^(?:object_?key|r2_?key|multipart_?id|token_?hash|upload_?token_?hash|secret|previous_?secret|digest)$/i;
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    assert(!forbidden.test(key), `Private field exposed: ${key}`);
    assertNoPrivateFields(child);
  }
}

export async function eventually(work, message, attempts = 100) {
  for (let n = 0; n < attempts; n++) {
    if (await work()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.fail(message);
}
