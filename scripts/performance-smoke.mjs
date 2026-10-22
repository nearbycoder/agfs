// Run through scripts/integration.mjs with freshly built SDK/CLI distributions.
// Uses only disposable local D1/R2 state and the existing Alice token fixture.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AgfsClient } from "../packages/sdk/dist/index.js";
import { database } from "./platform-fixtures.mjs";

const base = "http://localhost:8787",
  alias = "http://127.0.0.1:8787",
  token = "agfs_local_test_alice",
  root = "/performance-" + randomUUID(),
  local = await mkdtemp(join(tmpdir(), "agfs-performance-smoke-")),
  client = new AgfsClient({ baseUrl: base, token }),
  aliasClient = new AgfsClient({ baseUrl: alias, token });
const command = (baseUrl, ...args) =>
  execFileSync(process.execPath, ["packages/cli/dist/index.js", ...args], {
    encoding: "utf8",
    timeout: 120_000,
    env: {
      ...process.env,
      XDG_CONFIG_HOME: join(local, "config"),
      AGFS_BASE_URL: baseUrl,
      AGFS_TOKEN: token,
    },
  });
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const bytesAt = async (path, reader = client) =>
  Buffer.from(await (await reader.download(path)).arrayBuffer());

try {
  await client.mkdir(root);
  // Root + deep + 98 children reaches the supported 100-component boundary.
  const segments = [root.slice(1), "deep", ...Array.from({ length: 98 }, (_, i) => "d" + i)],
    deep = "/" + segments.join("/"),
    paths = segments.map((_, i) => "/" + segments.slice(0, i + 1).join("/"));
  await client.mkdir(deep);
  await client.mkdir(deep); // Creating the same chain remains idempotent.
  const folders = database.prepare(
    "SELECT path,parent_path,kind FROM entries WHERE owner_id='alice' AND (path=? OR substr(path,1,length(?))=?) ORDER BY length(path)",
  ).all(root, root + "/", root + "/");
  assert.deepEqual(folders.map((folder) => folder.path), paths);
  for (const [index, folder] of folders.entries()) {
    assert.equal(folder.kind, "folder");
    assert.equal(folder.parent_path, index === 0 ? "/" : paths[index - 1]);
  }
  assert.deepEqual((await client.list(deep)).entries, []);
  console.log("Performance smoke: 100-level folder creation passed.");

  const inputPath = root + "/input.txt",
    inputBytes = Buffer.from("Retained input before the source changes.\n"),
    outputSeed = root + "/output-seed.txt",
    outputBytes = Buffer.from("Real R2 output shared by 200 distinct fixture paths.\n"),
    outputDir = root + "/run-outputs";
  const input = await client.upload(inputPath, inputBytes, { contentType: "text/plain" });
  const output = await client.upload(outputSeed, outputBytes, { contentType: "text/plain" });
  await client.mkdir(outputDir);
  const inputs = Array(50).fill(inputPath);
  const run = await client.startRun("Performance smoke", outputDir, {
    inputs,
    metadata: { suite: "performance-smoke" },
    retentionDays: 1,
  });
  assert.equal(run.status, "running");
  const captured = await client.json("/platform/runs/" + run.id);
  assert.deepEqual(JSON.parse(captured.inputs).map((entry) => entry.path), inputs);
  await client.upload(inputPath, new Blob(["Replacement input after capture.\n"]));

  // Completion discovers files, rather than accepting an outputs array. Like
  // expansion-smoke, seed aliases in the disposable database. Each path points
  // at an actual uploaded R2 object; the run still validates/pins real objects.
  const outputPaths = Array.from({ length: 200 }, (_, i) =>
    outputDir + "/" + String(i).padStart(3, "0") + ".txt",
  );
  const copy = database.prepare(
    "INSERT INTO entries(id,owner_id,parent_path,path,name,kind,size,content_type,etag,r2_key,created_at,updated_at) SELECT ?,owner_id,?,?,?,'file',size,content_type,etag,r2_key,?,? FROM entries WHERE owner_id='alice' AND path=? AND kind='file'",
  );
  database.exec("BEGIN");
  try {
    for (const path of outputPaths) {
      const at = Date.now();
      assert.equal(copy.run("ent_" + randomUUID(), outputDir, path, path.split("/").at(-1), at, at, outputSeed).changes, 1);
    }
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
  const { manifest } = await client.completeRun(run.id);
  assert.equal(manifest.version, 1);
  assert.equal(manifest.runId, run.id);
  assert.deepEqual(manifest.metadata, { suite: "performance-smoke" });
  assert.deepEqual(manifest.inputs.map((entry) => entry.path), inputs);
  for (const entry of manifest.inputs) {
    assert.equal(entry.etag, input.etag);
    assert.equal(entry.size, inputBytes.length);
    assert(!("r2_key" in entry));
  }
  assert.deepEqual(manifest.artifacts.map((entry) => entry.path), outputPaths);
  for (const entry of manifest.artifacts) {
    assert.equal(entry.size, outputBytes.length);
    assert.equal(entry.etag, output.etag);
    assert.equal(entry.contentType, "text/plain");
    assert(!("r2_key" in entry));
  }
  assert.deepEqual((await client.completeRun(run.id)).manifest, manifest);
  assert.equal((await client.json("/platform/runs/" + run.id)).status, "completed");
  assert.equal(database.prepare("SELECT count(*) AS n FROM run_artifacts WHERE run_id=? AND kind='input'").get(run.id).n, 1);
  assert.equal(database.prepare("SELECT count(*) AS n FROM run_artifacts WHERE run_id=? AND kind='output'").get(run.id).n, 200);
  assert.equal(database.prepare("SELECT count(*) AS n FROM object_pins WHERE reference_id=? AND expires_at>?").get(run.id, Date.now()).n, 2);
  for (const [kind, path, expected] of [
    ["input", inputPath, inputBytes],
    ["output", outputPaths[0], outputBytes],
    ["output", outputPaths.at(-1), outputBytes],
  ]) {
    const response = await client.request("/api/v1/platform/runs/" + run.id + "/file?" + new URLSearchParams({ kind, path }));
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), expected);
  }
  console.log("Performance smoke: 50 retained inputs and 200 completed outputs passed.");

  const transferDir = root + "/downloads",
    multipartPath = transferDir + "/nested/multipart.bin",
    multipartBytes = randomBytes(16 * 1024 * 1024 + 1009),
    progress = [],
    parts = [];
  // This transport observes real requests; it does not mock the Worker or R2.
  const transferClient = new AgfsClient({
    baseUrl: base,
    token,
    fetch: async (url, init) => {
      const part = /\/fs\/resumable\/[^/]+\/parts\/(\d+)$/.exec(new URL(url).pathname);
      if (init?.method === "PUT" && part) parts.push(Number(part[1]));
      return fetch(url, init);
    },
  });
  const uploaded = await transferClient.upload(multipartPath, multipartBytes, {
    concurrency: 3,
    contentType: "application/octet-stream",
    onProgress: (bytes) => progress.push(bytes),
  });
  assert.equal(uploaded.path, multipartPath);
  assert.equal(uploaded.size, multipartBytes.length);
  assert.deepEqual([...new Set(parts)].sort((a, b) => a - b), [1, 2, 3]);
  assert.equal(progress.length, 3);
  assert.equal(progress.at(-1), multipartBytes.length);
  for (const [index, bytes] of progress.entries()) {
    assert(Number.isSafeInteger(bytes) && bytes > (progress[index - 1] ?? 0));
    assert(bytes <= multipartBytes.length);
  }
  const downloaded = await bytesAt(multipartPath);
  assert.equal(downloaded.length, multipartBytes.length);
  assert.equal(hash(downloaded), hash(multipartBytes), "Multipart download must preserve every byte and part order");
  console.log("Performance smoke: parallel multipart bytes and monotonic progress passed.");

  // integration.mjs configures APP_URL=localhost; both clients deliberately use
  // 127.0.0.1 so the returned empty-upload capability crosses loopback aliases.
  const sdkEmpty = transferDir + "/sdk-empty.bin",
    cliEmpty = transferDir + "/nested/cli-empty.bin",
    emptyFile = join(local, "empty.bin");
  const empty = await aliasClient.upload(sdkEmpty, new Uint8Array());
  assert.equal(empty.path, sdkEmpty);
  assert.equal(empty.size, 0);
  await writeFile(emptyFile, new Uint8Array());
  command(alias, "upload", emptyFile, cliEmpty);
  for (const path of [sdkEmpty, cliEmpty]) {
    const parent = path.slice(0, path.lastIndexOf("/"));
    assert.equal((await client.list(parent)).entries.find((entry) => entry.path === path)?.size, 0);
    assert.equal((await bytesAt(path)).length, 0);
    assert.equal((await bytesAt(path, aliasClient)).length, 0);
  }
  console.log("Performance smoke: SDK/CLI empty uploads across loopback aliases passed.");

  const textBytes = Buffer.from("Parallel folder download: UTF-8 \u2603\n"),
    binaryBytes = Buffer.from([0, 1, 127, 128, 254, 255]);
  await client.upload(transferDir + "/note.txt", textBytes, { contentType: "text/plain" });
  await client.upload(transferDir + "/nested/small.bin", binaryBytes);
  await client.mkdir(transferDir + "/nested/empty-directory");
  const destination = join(local, "downloaded");
  command(alias, "download", transferDir, destination, "--concurrency", "2");
  assert.deepEqual((await readdir(destination)).sort(), ["nested", "note.txt", "sdk-empty.bin"]);
  assert.deepEqual((await readdir(join(destination, "nested"))).sort(), ["cli-empty.bin", "empty-directory", "multipart.bin", "small.bin"]);
  for (const [path, expected] of [
    ["note.txt", textBytes],
    ["sdk-empty.bin", Buffer.alloc(0)],
    ["nested/cli-empty.bin", Buffer.alloc(0)],
    ["nested/small.bin", binaryBytes],
    ["nested/multipart.bin", multipartBytes],
  ]) {
    const actual = await readFile(join(destination, path));
    assert.equal(actual.length, expected.length, path + " size");
    assert.equal(hash(actual), hash(expected), path + " bytes");
  }
  assert((await stat(join(destination, "nested/empty-directory"))).isDirectory());
  assert.deepEqual(await readdir(join(destination, "nested/empty-directory")), []);
  console.log("Performance smoke: built CLI folder download with concurrency 2 passed.");
  await client.remove(root, true);
  console.log("Performance integration checks passed.");
} finally {
  try {
    await rm(local, { recursive: true, force: true });
  } finally {
    database.close();
  }
}
