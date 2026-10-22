// Built SDK and CLI plus Python source against the same real disposable Worker.
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { walk, captureInventory, compareInventories, copyFile, readLines, readJsonLines,
  publishText, transformJson, mergeJsonPatch, changeBatches, diagnoseError, verifyWebhook, stageDraft, withRun } from "../packages/sdk/dist/index.js";
import { assertUnchangedInventoryDiff, createFixture, requirePythonAssertions, sha256, suite } from "./feature-expansion-fixtures.mjs";

// Fail before creating a fixture when inherited interpreter options erase checks.
requirePythonAssertions();
const f = await createFixture(), { client, otherClient, root, db, id } = f;
const s = suite("Feature clients integration"), local = mkdtempSync(join(tmpdir(), "agfs-feature-clients-"));
const env = { ...process.env, AGFS_BASE_URL: f.base, AGFS_TOKEN: f.credential.value, XDG_CONFIG_HOME: join(local, "config"),
  AGFS_FEATURE_ROOT: root, PYTHONPATH: resolve("packages/python-sdk"), PYTHONDONTWRITEBYTECODE: "1" };
const cliFile = resolve("packages/cli/dist/index.js");
function cli(args, { status = 0, offline = false } = {}) {
  try {
    const stdout = execFileSync(process.execPath, [cliFile, "--json-errors", ...args], {
      env: { ...env, ...(offline ? { AGFS_BASE_URL: "http://127.0.0.1:1", AGFS_TOKEN: "" } : {}) },
      encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 60000, maxBuffer: 2 * 1024 * 1024,
    });
    assert.equal(status, 0, "Expected a failing CLI command");
    return stdout.trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
  } catch (error) {
    if (!Object.hasOwn(error, "status")) throw error;
    assert.equal(error.status, status, `CLI ${args[0]} exit: ${String(error.stderr)}`);
    assert.equal(String(error.stdout), "", "Failed command must keep data stdout empty");
    const lines = String(error.stderr).trim().split("\n").filter(Boolean);
    assert.equal(lines.length, 1, "One structured error record");
    const diagnostic = JSON.parse(lines[0]);
    assert(!JSON.stringify(diagnostic).includes(f.credential.value));
    return diagnostic;
  }
}
const collect = async (iterable) => { const values = []; for await (const value of iterable) values.push(value); return values; };
let lineCheckpoint;
try {
  await client.mkdir(root);
  await client.mkdir(root + "/tree"); await client.mkdir(root + "/tree/child");
  await client.upload(root + "/tree/a.txt", Buffer.from("tree a\n"), { contentType: "text/plain" });
  await client.upload(root + "/tree/child/b.txt", Buffer.from("tree b\n"), { contentType: "text/plain" });
  const linePath = root + "/lines.txt", lineBytes = Buffer.from("雪🌱\r\nsecond\nfinal\r");
  await client.upload(linePath, lineBytes, { contentType: "text/plain" });
  const jsonl = root + "/records.jsonl";
  await client.upload(jsonl, Buffer.from('{"id":1,"name":"雪"}\n{"id":2}\n'), { contentType: "application/jsonl" });

  await s.test("#105 bounded pull traversal stops after one list when consumer stops", async () => {
    const traced = f.tracedClient();
    for await (const entry of walk(traced.client, root + "/tree")) { assert(entry.path.startsWith(root + "/tree/")); break; }
    assert.equal(traced.calls.length, 1); assert.equal(traced.calls[0].path, "/api/v1/fs/list");
    const shallow = await collect(walk(client, root + "/tree", { maxDepth: 0 }));
    assert.equal(shallow.length, 2); assert(!shallow.some((e) => e.path.endsWith("/b.txt")));
    await assert.rejects(collect(walk(client, root + "/tree", { maxEntries: 1 })), { name: "ResourceLimitError" });
  });

  await s.test("#106/#107 metadata inventory and offline scope-bound comparison", async () => {
    const traced = f.tracedClient(), before = await captureInventory(traced.client, root + "/tree");
    assert.equal(before.entries.length, 3);
    assert.deepEqual(traced.calls.map((r) => r.path), ["/api/v1/whoami", "/api/v1/fs/list", "/api/v1/fs/list"]);
    await client.upload(root + "/tree/a.txt", Buffer.from("changed"));
    const after = await captureInventory(client, root + "/tree"), calls = traced.calls.length;
    const diff = compareInventories(before, after);
    assert.equal(diff.find((r) => r.path.endsWith("/a.txt")).status, "changed");
    assert.equal(diff.find((r) => r.path.endsWith("/b.txt")).status, "unchanged");
    assert.equal(traced.calls.length, calls);
    assert.throws(() => compareInventories(before, { ...after, root: "/" }), /different scopes/);
  });

  await s.test("#109 cross-client streamed copy preserves bytes and isolates credentials, then refuses overwrite", async () => {
    await otherClient.mkdir(root);
    const source = f.tracedClient(), destination = f.tracedClient(f.otherCredential.value);
    const copied = await copyFile(source.client, destination.client, linePath, root + "/copied.txt");
    assert.equal(source.calls.length, 2); assert.equal(destination.calls.length, 3);
    assert.deepEqual(Buffer.from(await (await otherClient.download(root + "/copied.txt", copied.etag)).arrayBuffer()), lineBytes);
    await assert.rejects(copyFile(source.client, destination.client, linePath, root + "/copied.txt"), { status: 409 });
    assert.deepEqual(Buffer.from(await (await otherClient.download(root + "/copied.txt")).arrayBuffer()), lineBytes);
    await assert.rejects(copyFile(source.client, destination.client, linePath, root + "/too-large.txt", { maxBytes: 1 }), { name: "ResourceLimitError" });
  });

  await s.test("#110 UTF-8 complete-line checkpoints resume with an exact preceding-byte range", async () => {
    const traced = f.tracedClient();
    for await (const row of readLines(traced.client, linePath)) {
      assert.equal(row.text, "雪🌱"); assert.equal(row.checkpoint.offset, Buffer.byteLength("雪🌱\r\n")); lineCheckpoint = row.checkpoint; break;
    }
    assert.equal(traced.calls.length, 2);
    traced.calls.length = 0;
    const tail = await collect(readLines(traced.client, linePath, { checkpoint: lineCheckpoint }));
    assert.deepEqual(tail.map((r) => r.text), ["second", "final\r"]);
    assert.equal(tail.at(-1).checkpoint.offset, lineBytes.length); assert.equal(tail.at(-1).line, 3);
    assert.equal(traced.calls[1].range, `bytes=${lineCheckpoint.offset - 1}-${lineBytes.length - 1}`);
    const malformed = { ...lineCheckpoint }; delete malformed.offset;
    const before = traced.calls.length;
    await assert.rejects(collect(readLines(traced.client, linePath, { checkpoint: malformed })), /checkpoint/i);
    assert.equal(traced.calls.length, before);
  });

  await s.test("#111 JSONL validation and error-line diagnostics use the real range endpoint", async () => {
    const records = await collect(readJsonLines(client, jsonl, { validate: (value) => { assert.equal(typeof value.id, "number"); return value; } }));
    assert.deepEqual(records.map((r) => r.value.id), [1, 2]);
    const malformed = root + "/bad-records.jsonl";
    await client.upload(malformed, Buffer.from('{"id":1}\n{broken}\n'));
    const seen = [];
    await assert.rejects(async () => { for await (const row of readJsonLines(client, malformed)) seen.push(row.value); }, (error) => error.name === "JsonLineError" && error.line === 2);
    assert.deepEqual(seen, [{ id: 1 }]);
  });

  await s.test("#112 identical text makes no upload and changed text publishes conditionally", async () => {
    const traced = f.tracedClient(), path = root + "/published.txt";
    assert.equal((await publishText(traced.client, path, "published 雪\n")).changed, true);
    traced.calls.length = 0;
    assert.equal((await publishText(traced.client, path, "published 雪\n")).changed, false);
    assert.deepEqual(traced.calls.map((r) => r.method), ["GET", "GET"]);
    assert.equal((await publishText(traced.client, path, "changed 雪\n")).changed, true);
    assert.equal(await client.readText(path), "changed 雪\n");
  });

  await s.test("#113 merge-patch null semantics and concurrent transform conflict invoke callback once", async () => {
    const path = root + "/document.json";
    await client.upload(path, Buffer.from('{"keep":1,"remove":2,"nested":{"a":1}}'), { contentType: "application/json" });
    await transformJson(client, path, (value) => mergeJsonPatch(value, { remove: null, nested: { b: 2 } }));
    assert.deepEqual(JSON.parse(await client.readText(path)), { keep: 1, nested: { a: 1, b: 2 } });
    let calls = 0;
    await assert.rejects(transformJson(client, path, async () => {
      calls++; await client.upload(path, Buffer.from('{"concurrent":true}'), { contentType: "application/json" }); return { overwritten: true };
    }), { status: 409 });
    assert.equal(calls, 1); assert.deepEqual(JSON.parse(await client.readText(path)), { concurrent: true });
  });

  await s.test("#114 resumed change window holds its original through despite later arrivals", async () => {
    const path = root + "/window"; await client.mkdir(path);
    const initial = await collect(changeBatches(client, path));
    const since = initial.at(-1).checkpoint.through;
    for (let n = 0; n < 501; n++) f.entry(path + "/" + String(n).padStart(4, "0") + ".txt");
    const iterator = changeBatches(client, path, { since });
    const first = (await iterator.next()).value; assert.equal(first.changes.length, 500); assert.equal(first.checkpoint.complete, false);
    await iterator.return();
    f.entry(path + "/later.txt");
    const rest = await collect(changeBatches(client, path, { checkpoint: first.checkpoint }));
    assert.equal(rest.length, 1); assert.equal(rest[0].changes.length, 1); assert.equal(rest[0].checkpoint.complete, true);
    assert.equal(rest[0].checkpoint.through, first.checkpoint.through);
    assert(!rest[0].changes.some((r) => r.path.endsWith("/later.txt")));
    const next = await collect(changeBatches(client, path, { checkpoint: rest[0].checkpoint }));
    assert(next[0].changes.some((r) => r.path.endsWith("/later.txt")));
  });

  await s.test("#115/#116 actual transport budgets refuse extra/closed attempts and retain structured run recovery", async () => {
    const traced = f.tracedClient(); let retained;
    await assert.rejects(traced.client.withScope({ maxRequests: 2, timeoutMs: 10000 }, async (scoped) => {
      retained = scoped; await scoped.whoami(); await scoped.list(root); await scoped.whoami();
    }), (error) => diagnoseError(error).category === "budget");
    assert.equal(traced.calls.length, 2);
    await assert.rejects(retained.whoami()); assert.equal(traced.calls.length, 2);
    const deadline = f.tracedClient(); let timedClient;
    await assert.rejects(deadline.client.withScope({ maxRequests: 3, timeoutMs: 100 }, async (scoped) => {
      timedClient = scoped; await scoped.whoami(); await new Promise((resolve) => setTimeout(resolve, 150));
    }), (error) => diagnoseError(error).category === "timeout");
    assert(deadline.calls.length <= 1);
    const attempts = deadline.calls.length;
    await assert.rejects(timedClient.whoami()); assert.equal(deadline.calls.length, attempts);
    let callbackCalls = 0, failure;
    try { await withRun(client, "Intentional local failure", root, async () => { callbackCalls++; throw new Error("local callback failure"); }); }
    catch (error) { failure = error; }
    const diagnostic = diagnoseError(failure);
    assert.equal(callbackCalls, 1); assert(diagnostic.resourceId); assert.equal(diagnostic.completed, 0);
    assert.equal(db.prepare("SELECT status FROM agent_runs WHERE id=? AND owner_id=?").get(diagnostic.resourceId, id).status, "running");
    assert(!JSON.stringify(diagnostic).includes(f.credential.value));
  });

  await s.test("#117 offline rotating-signature verification binds exact bytes and replay time", async () => {
    const timestamp = String(Math.floor(Date.now() / 1000)), body = Buffer.from('{"text":"雪"}'), secret = "synthetic-hmac-only";
    const signature = createHmac("sha256", secret).update(timestamp + ".").update(body).digest("hex");
    const headers = { timestamp, signature: "v1=" + "0".repeat(64) + ",v1=" + signature };
    const previousFetch = globalThis.fetch;
    globalThis.fetch = () => { throw new Error("Offline HMAC attempted network"); };
    try {
      assert.equal(await verifyWebhook(secret, body, headers), true);
      assert.equal(await verifyWebhook(secret, Buffer.concat([body, Buffer.from(" ")]), headers), false);
      assert.equal(await verifyWebhook(secret, body, headers, { nowSeconds: Number(timestamp) + 301 }), false);
    } finally { globalThis.fetch = previousFetch; }
  });

  await s.test("#118 draft staging validates before create and never approves/applies", async () => {
    const traced = f.tracedClient(), batch = { name: "Integration staged draft", path: root, changes: [
      { path: root + "/staged.txt", operation: "write", content: "human review required" },
    ] };
    await assert.rejects(stageDraft(traced.client, { ...batch, changes: [...batch.changes, { path: "/outside.txt", operation: "write", content: "no" }] }));
    assert.equal(traced.calls.length, 0);
    const staged = await stageDraft(traced.client, batch);
    assert.equal(staged.completed, 1); assert.equal(traced.calls.length, 2);
    assert.equal(db.prepare("SELECT status FROM draft_sets WHERE id=?").get(staged.id).status, "open");
    assert.equal(db.prepare("SELECT 1 FROM entries WHERE owner_id=? AND path=?").get(id, root + "/staged.txt"), undefined);
    assert(!traced.calls.some((r) => /review|apply/.test(r.path)));
  });

  await s.test("#119 managed run completes after one successful callback", async () => {
    const traced = f.tracedClient(); let invoked = 0;
    const result = await withRun(traced.client, "Successful local run", root + "/tree", async () => { invoked++; return "finished"; });
    assert.equal(invoked, 1); assert.equal(result.value, "finished");
    assert.equal(traced.calls.length, 2);
    assert.equal(db.prepare("SELECT status FROM agent_runs WHERE id=?").get(result.id).status, "completed");
  });

  await s.test("CLI #106–108 inventory capture/offline diff and interrupted export resume with exact bytes", async () => {
    const path = root + "/cli-data"; await client.mkdir(path);
    await client.upload(path + "/a.txt", Buffer.from("first 雪\n")); await client.upload(path + "/b.txt", Buffer.from("second 🌱\n"));
    const manifestFile = join(local, "inventory.json"), output = join(local, "export");
    assert.equal(cli(["inventory", "capture", path, "--out", manifestFile])[0].entries, 2);
    const captured = JSON.parse(readFileSync(manifestFile, "utf8"));
    assert.deepEqual(captured.entries.map((entry) => entry.path).sort(), [path + "/a.txt", path + "/b.txt"]);
    assertUnchangedInventoryDiff(cli(["inventory", "diff", manifestFile, manifestFile], { offline: true }), captured.entries);
    const stopped = cli(["--max-requests", "2", "export", manifestFile, output], { status: 8 });
    assert.equal(stopped.category, "budget");
    assert.equal(readFileSync(join(output, "a.txt"), "utf8"), "first 雪\n");
    const resumed = cli(["export", manifestFile, output])[0]; assert.equal(resumed.downloaded, 1); assert.equal(resumed.skipped, 1);
    assert.equal(readFileSync(join(output, "b.txt"), "utf8"), "second 🌱\n");
    const again = cli(["export", manifestFile, output])[0]; assert.equal(again.downloaded, 0); assert.equal(again.skipped, 2);
    writeFileSync(join(output, "a.txt"), "foreign local edit");
    const conflict = cli(["export", manifestFile, output], { status: 5 }); assert.equal(conflict.category, "conflict");
    assert.equal(readFileSync(join(output, "a.txt"), "utf8"), "foreign local edit");
  });

  await s.test("CLI #110–114 line resume/records/text/JSON/change workflows use real endpoints", async () => {
    writeFileSync(join(local, "line-checkpoint.json"), JSON.stringify(lineCheckpoint));
    assert.deepEqual(cli(["lines", linePath, "--checkpoint", join(local, "line-checkpoint.json")]).map((r) => r.text), ["second", "final\r"]);
    assert.deepEqual(cli(["records", jsonl]).map((r) => r.value.id), [1, 2]);
    const textFile = join(local, "publish.txt"); writeFileSync(textFile, "CLI publication 雪\n");
    assert.equal(cli(["text", "publish", textFile, root + "/cli-published.txt"])[0].changed, true);
    assert.equal(cli(["text", "publish", textFile, root + "/cli-published.txt"])[0].changed, false);
    const patch = join(local, "patch.json"); writeFileSync(patch, JSON.stringify({ concurrent: null, cli: true }));
    assert.equal(cli(["json", "patch", root + "/document.json", patch])[0].changed, true);
    assert.deepEqual(JSON.parse(await client.readText(root + "/document.json")), { cli: true });
    const changes = cli(["changes", root + "/cli-data"]); assert.equal(changes.at(-1).checkpoint.complete, true);
  });

  await s.test("CLI #118 draft stage remains unapplied and #120 offline bundle plan/resume validates sources", async () => {
    const draftFile = join(local, "draft.json");
    writeFileSync(draftFile, JSON.stringify({ name: "CLI human review", path: root, changes: [{ path: root + "/cli-stage.txt", operation: "write", content: "staged" }] }));
    const staged = cli(["draft", "stage", draftFile])[0]; assert.equal(staged.completed, 1);
    assert.equal(db.prepare("SELECT status FROM draft_sets WHERE id=?").get(staged.id).status, "open");
    assert.equal(db.prepare("SELECT 1 FROM entries WHERE owner_id=? AND path=?").get(id, root + "/cli-stage.txt"), undefined);
    const source = join(local, "bundle"), bundleFile = join(local, "bundle.json"); mkdirSync(source, { mode: 0o700 });
    writeFileSync(join(source, "one.txt"), "bundle one 雪"); writeFileSync(join(source, "two.txt"), "bundle two 🌱");
    await client.mkdir(root + "/bundle");
    writeFileSync(bundleFile, JSON.stringify({ version: 1, root: root + "/bundle", files: [
      { source: "one.txt", path: root + "/bundle/one.txt" }, { source: "two.txt", path: root + "/bundle/two.txt" },
    ] }));
    const plan = cli(["bundle", "upload", bundleFile, source, "--dry-run"], { offline: true })[0];
    assert.equal(plan.dryRun, true); assert.equal(plan.files.length, 2);
    assert.deepEqual(readdirSync(source).sort(), ["one.txt", "two.txt"]);
    // whoami + one destination list + three first-file upload calls = 5.
    assert.equal(cli(["--max-requests", "5", "bundle", "upload", bundleFile, source], { status: 8 }).category, "budget");
    const resumed = cli(["bundle", "upload", bundleFile, source])[0]; assert.equal(resumed.uploaded, 1); assert.equal(resumed.skipped, 1);
    assert.equal(cli(["bundle", "upload", bundleFile, source])[0].skipped, 2);
    for (const name of ["one.txt", "two.txt"])
      assert.equal(sha256(await (await client.download(root + "/bundle/" + name)).bytes()), sha256(readFileSync(join(source, name))));
    writeFileSync(join(source, "two.txt"), "changed local source");
    assert.equal(cli(["bundle", "upload", bundleFile, source], { status: 2 }).category, "invalid_input");
    assert.equal(await client.readText(root + "/bundle/two.txt"), "bundle two 🌱");
  });

  await s.test("Python #110/#111/#116/#117/#118/#119 live workflows and offline HMAC", async () => {
    const output = execFileSync("python3", ["scripts/feature-expansion-python-smoke.py"], { env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 60000 });
    const result = JSON.parse(output.trim()); assert.equal(result.passed, 8); console.log(output.trim());
  });
  // Change-window candidates contain synthetic metadata; queue verification owns
  // a separate owner with actual R2 objects and must not consume these candidates.
  for (const actor of [f.session, f.otherSession]) await f.ops("/background", { method: "PUT", actor, body: { indexingPaused: true, webhooksPaused: true } });
  s.finish({ owner: id, namespace: root });
} finally {
  rmSync(local, { recursive: true, force: true });
}
