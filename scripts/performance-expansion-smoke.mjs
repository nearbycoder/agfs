// Additional performance paths against disposable Workers, D1 and R2.
// Run through integration.mjs after building the workspace.
import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { AgfsClient, mapConcurrent, mapConcurrentIterable } from "../packages/sdk/dist/index.js";
import { cookie, database } from "./platform-fixtures.mjs";

const base = "http://localhost:8787",
  root = "/performance-expansion-" + randomUUID(),
  alice = cookie(),
  bob = cookie("bob"),
  local = await mkdtemp(join(tmpdir(), "agfs-expansion-smoke-")),
  client = new AgfsClient({ baseUrl: base, token: "agfs_local_test_alice" });
let checks = 0;
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
function byteStream(bytes, chunkSize = 65537) {
  let offset = 0;
  return new ReadableStream({
    pull(controller) {
      if (offset === bytes.length) return controller.close();
      const end = Math.min(bytes.length, offset + chunkSize);
      controller.enqueue(bytes.subarray(offset, end));
      offset = end;
    },
  }, { highWaterMark: 0 });
}
async function request(path, { session = alice, method = "GET", body, headers, status = 200 } = {}) {
  const response = await fetch(base + path, {
    method,
    redirect: "manual",
    headers: {
      cookie: session,
      ...(body === undefined ? {} : { origin: base, "content-type": "application/json" }),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (response.status !== status)
    assert.fail(`${method} ${path}: expected ${status}, got ${response.status}: ${await response.text()}`);
  checks++;
  return response;
}
async function platform(path, options) {
  return (await request("/api/v1/platform" + path, options)).json();
}

try {
  await client.mkdir(root);
  const source = Buffer.from("0123456789abcdefghijklmnopqrstuvwxyz"),
    file = root + "/ranged.txt",
    entry = await client.upload(file, source, { contentType: "text/plain" }),
    download = "/api/v1/fs/download?" + new URLSearchParams({ path: file });
  for (const [range, expected, contentRange] of [
    ["bytes=0-4", source.subarray(0, 5), "bytes 0-4/36"],
    ["bytes=10-", source.subarray(10), "bytes 10-35/36"],
    ["bytes=-6", source.subarray(-6), "bytes 30-35/36"],
    ["bytes=32-999", source.subarray(32), "bytes 32-35/36"],
  ]) {
    const response = await request(download, {
      headers: { range, "if-match": entry.etag }, status: 206,
    });
    assert.equal(response.headers.get("content-range"), contentRange);
    assert.equal(response.headers.get("content-length"), String(expected.length));
    assert.match(response.headers.get("cache-control"), /no-store/);
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), expected);
    checks += 4;
  }
  const beyond = await request(download, { headers: { range: "bytes=36-" }, status: 416 });
  assert.equal(beyond.headers.get("content-range"), "bytes */36");
  checks++;
  await beyond.arrayBuffer();
  await (await request(download, { headers: { range: "bytes=0-2", "if-match": "outdated-version" }, status: 412 })).arrayBuffer();
  await (await request(download, { session: bob, headers: { range: "bytes=0-2" }, status: 404 })).arrayBuffer();
  const full = await request(download);
  assert.deepEqual(Buffer.from(await full.arrayBuffer()), source);
  const conditionalRange = await request(download, {
    headers: { range: "bytes=2-4", "if-range": '"' + entry.etag + '"' }, status: 206,
  });
  assert.deepEqual(Buffer.from(await conditionalRange.arrayBuffer()), source.subarray(2, 5));
  for (const headers of [
    { range: "bytes=2-4", "if-range": '"old-version"' },
    { range: "bytes=0-2,8-9" },
  ]) {
    const response = await request(download, { headers });
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), source);
  }
  checks += 4;
  const preview = await (await request("/api/v1/fs/preview", { method: "POST", body: { path: file } })).json(),
    previewUrl = preview.url,
    head = await fetch(previewUrl, { method: "HEAD", redirect: "manual" });
  assert.equal(head.status, 200);
  assert.equal(head.headers.get("content-length"), String(source.length));
  assert.match(head.headers.get("content-security-policy"), /sandbox/);
  assert.equal((await head.arrayBuffer()).byteLength, 0);
  const view = await fetch(previewUrl, { redirect: "manual" });
  assert.equal(view.status, 200);
  assert.deepEqual(Buffer.from(await view.arrayBuffer()), source);
  checks += 6;
  console.log("Performance expansion: ranged downloads, conditional/owner guards, and preview HEAD passed.");

  const notePath = "/notes?" + new URLSearchParams({ path: file }),
    emptyNote = await platform(notePath);
  assert.equal(emptyNote.note, null);
  assert.equal(emptyNote.entry.id, entry.id);
  await platform("/notes", { method: "PUT", body: { path: file, entryId: entry.id, body: "", revision: 0 } });
  const savedNote = await platform(notePath);
  assert.equal(savedNote.note.body, "");
  assert.equal(savedNote.note.revision, 1);
  await platform(notePath, { session: bob, status: 404 });
  const collection = await platform("/collections", { method: "POST", body: { name: root.slice(1) }, status: 201 }),
    items = "/collections/" + collection.id + "/items";
  assert.deepEqual((await platform(items)).items, []);
  await platform(items, { method: "PUT", body: { path: file } });
  assert.deepEqual((await platform(items)).items.map((item) => item.id), [entry.id]);
  await platform(items, { session: bob, status: 404 });
  await platform("/collections/" + collection.id, { method: "DELETE" });
  await platform(items, { status: 404 });
  const checkpoint = await client.changes(root);
  assert(Number.isSafeInteger(checkpoint.checkpoint));
  assert.deepEqual((await client.changes(root, checkpoint.checkpoint)).changes, []);
  const health = await platform("/health");
  assert.deepEqual(Object.keys(health).sort(), ["alerts", "expiringCredentials", "indexing", "jobs", "metrics", "thresholds", "webhooks"]);
  assert(Array.isArray(health.metrics));
  assert(Number.isFinite(health.indexing.pending));
  checks += 11;
  console.log("Performance expansion: joined notes/collections, checkpoints, and batched health passed.");

  const draftFolder = root + "/draft",
    draftFiles = Array.from({ length: 30 }, (_, i) => ({
      path: draftFolder + "/file-" + String(i).padStart(2, "0") + ".txt",
      content: "Verified thirty-file draft output " + i + "\n",
    }));
  await client.mkdir(draftFolder);
  const draft = await client.createDraft("Thirty-file performance expansion", draftFolder);
  await mapConcurrent(draftFiles, 3, (change) => client.changeDraft(draft.id, { ...change, operation: "write" }));
  await platform("/drafts/" + draft.id + "/review", { method: "POST", body: { accept: true } });
  await client.applyDraft(draft.id);
  assert.equal((await client.list(draftFolder)).entries.length, 30);
  await mapConcurrent(draftFiles, 3, async ({ path, content }) => {
    assert.equal(await client.readText(path), content);
  });
  assert.equal((await client.getDraft(draft.id)).status, "applied");
  checks += 32;
  console.log("Performance expansion: maximum thirty-file draft apply and exact contents passed.");

  const streamBytes = randomBytes(16 * 1024 * 1024 + 503),
    streamPath = root + "/streams/source.bin",
    progress = [],
    stream = byteStream(streamBytes),
    uploaded = await client.uploadStream(streamPath, stream, streamBytes.length, {
      ifMatch: null, onProgress: (bytes) => progress.push(bytes),
    });
  assert.equal(stream.locked, false);
  assert.equal(uploaded.size, streamBytes.length);
  assert.equal(progress.at(-1), streamBytes.length);
  assert(progress.every((bytes, index) => bytes > (progress[index - 1] ?? 0)));
  assert.equal(digest(Buffer.from(await (await client.download(streamPath)).arrayBuffer())), digest(streamBytes));
  const badStream = byteStream(streamBytes.subarray(0, 8388611));
  await assert.rejects(client.uploadStream(root + "/streams/truncated.bin", badStream, 8388616), /size mismatch/);
  assert.equal(badStream.locked, false);
  assert(!(await client.list(root + "/streams")).entries.some((item) => item.name === "truncated.bin"));
  const extraStream = byteStream(Buffer.from("extra"));
  await assert.rejects(client.uploadStream(root + "/streams/oversized.bin", extraStream, 3), /size mismatch/);
  assert.equal(extraStream.locked, false);
  const aliasClient = new AgfsClient({ baseUrl: "http://127.0.0.1:8787", token: "agfs_local_test_alice" });
  assert.equal((await aliasClient.uploadStream(root + "/streams/empty.bin", byteStream(Buffer.alloc(0)), 0)).size, 0);
  let pulled = 0, closed = false;
  function* inputs() {
    try {
      for (const item of draftFiles) { pulled++; yield item; }
    } finally { closed = true; }
  }
  const mapped = [];
  for await (const text of mapConcurrentIterable(inputs(), 3, (item) => client.readText(item.path))) {
    mapped.push(text);
    if (mapped.length === 2) break;
  }
  assert.deepEqual(mapped, draftFiles.slice(0, 2).map((item) => item.content));
  assert(pulled <= 4, "Early stopping must not pull the whole input iterable");
  assert.equal(closed, true);
  // A producer may require acknowledgment before it supplies another input.
  // Ready ordered results must not wait behind that next source pull.
  let acknowledge;
  const acknowledgment = new Promise((resolve) => { acknowledge = resolve; });
  async function* acknowledgedInputs() {
    yield draftFiles[0];
    await acknowledgment;
    yield draftFiles[1];
  }
  const acknowledgedResults = [];
  const consuming = (async () => {
    for await (const content of mapConcurrentIterable(acknowledgedInputs(), 2, (item) => client.readText(item.path))) {
      acknowledgedResults.push(content);
      acknowledge();
    }
  })();
  let timeout;
  try {
    await Promise.race([
      consuming,
      new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error("Lazy mapping blocked consumer acknowledgment")), 5000); }),
    ]);
  } finally {
    clearTimeout(timeout);
    acknowledge();
    await consuming;
  }
  assert.deepEqual(acknowledgedResults, draftFiles.slice(0, 2).map((item) => item.content));
  checks += 15;
  console.log("Performance expansion: streamed SDK uploads, failed-stream isolation, and lazy mapping passed.");

  const sourceFile = join(local, "python-source.bin");
  await writeFile(sourceFile, streamBytes);
  const python = execFileSync("python3", ["-c", `
import hashlib, os
from pathlib import Path
from agfs_sdk import AgfsClient
client=AgfsClient('agfs_local_test_alice', base_url='http://127.0.0.1:8787')
root=os.environ['AGFS_EXPANSION_ROOT']
directory=Path(os.environ['AGFS_EXPANSION_LOCAL'])
source=directory/'python-source.bin'
def digest(path):
    with path.open('rb') as file:return hashlib.file_digest(file,'sha256').hexdigest()
expected=digest(source)
for prefetch in (True,False):
    path=root+'/python/'+str(prefetch)+'.bin'
    progress=[]
    entry=client.upload_file(source,path,if_match=None,prefetch=prefetch,on_progress=progress.append)
    assert progress[-1]==source.stat().st_size
    assert progress==sorted(set(progress))
    destination=directory/('python-'+str(prefetch)+'.bin')
    destination.write_bytes(b'Previous destination survives until atomic replacement')
    downloaded=[]
    result=client.download_file(path,destination,if_match=entry['etag'],chunk_size=32768,on_progress=downloaded.append)
    assert result==destination
    assert digest(destination)==expected
    assert downloaded[-1]==source.stat().st_size
    assert downloaded==sorted(set(downloaded))
    assert not list(directory.glob('.agfs-download-*'))
empty=directory/'empty.bin'
empty.write_bytes(b'')
entry=client.upload_file(empty,root+'/python/empty.bin',if_match=None)
assert entry['size']==0
client.download_file(entry['path'],directory/'python-empty.bin')
assert (directory/'python-empty.bin').read_bytes()==b''
parent=directory/'path-validation'
outside=directory/'outside'
parent.mkdir()
(outside/'nested').mkdir(parents=True)
(parent/'link').symlink_to(outside/'nested',target_is_directory=True)
(parent/'file').write_bytes(b'parent original')
(outside/'file').write_bytes(b'outside original')
try:
    client.download_file(entry['path'],parent/'link'/'..'/'file')
except ValueError:
    pass
else:
    raise AssertionError('Ambiguous symlink/parent path was accepted')
assert (parent/'file').read_bytes()==b'parent original'
assert (outside/'file').read_bytes()==b'outside original'
print('Python pipelined/sequential uploads, atomic downloads, and empty alias upload passed.')
`], {
    encoding: "utf8", timeout: 120000,
    env: { ...process.env, PYTHONPATH: "packages/python-sdk", AGFS_EXPANSION_ROOT: root, AGFS_EXPANSION_LOCAL: local },
  });
  console.log(python.trim());

  const syncRoot = root + "/sync",
    syncLocal = join(local, "sync"),
    syncFiles = Array.from({ length: 24 }, (_, i) => ({
      name: "group-" + (i % 6) + "/file-" + i + ".txt", text: "Identical sync input " + i + "\n",
    }));
  await client.mkdir(syncRoot);
  await mkdir(syncLocal);
  await mapConcurrent(syncFiles, 3, async ({ name, text }) => {
    const destination = join(syncLocal, name);
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, text);
    await client.upload(syncRoot + "/" + name, new Blob([text]), { ifMatch: null, contentType: "text/plain" });
  });
  await writeFile(join(syncLocal, ".agfsignore"), "**/ignored*.txt\n");
  await writeFile(join(syncLocal, "group-0/ignored-local.txt"), "keep private");
  await client.upload(syncRoot + "/group-1/ignored-remote.txt", new Blob(["skip locally"]));
  const sync = (...args) => execFileSync(process.execPath, [
    "packages/cli/dist/index.js", "sync", syncLocal, syncRoot, "--concurrency", "3", ...args,
  ], {
    encoding: "utf8", timeout: 120000,
    env: { ...process.env, XDG_CONFIG_HOME: join(local, "config"), AGFS_BASE_URL: base, AGFS_TOKEN: "agfs_local_test_alice" },
  });
  assert.match(sync(), /Sync complete/);
  const state = JSON.parse(await readFile(join(syncLocal, ".agfs-sync.json"), "utf8"));
  assert.equal(Object.keys(state.files).length, syncFiles.length);
  assert(!(await readdir(join(syncLocal, "group-1"))).includes("ignored-remote.txt"));
  assert(!(await client.list(syncRoot + "/group-0")).entries.some((entry) => entry.name === "ignored-local.txt"));
  assert.match(sync(), /Sync complete/);
  await writeFile(join(syncLocal, syncFiles[0].name), "Local changed content\n");
  await client.upload(syncRoot + "/" + syncFiles[1].name, new Blob(["Remote changed content\n"]));
  assert.match(sync(), /Sync complete/);
  assert.equal(await client.readText(syncRoot + "/" + syncFiles[0].name), "Local changed content\n");
  assert.equal(await readFile(join(syncLocal, syncFiles[1].name), "utf8"), "Remote changed content\n");
  // A size mismatch must remain a conflict with both originals untouched.
  const conflict = "untracked-size-conflict.txt";
  await writeFile(join(syncLocal, conflict), "short");
  await client.upload(syncRoot + "/" + conflict, new Blob(["a much larger remote version"]));
  assert.throws(() => sync(), /Sync found conflicts/);
  assert.equal(await readFile(join(syncLocal, conflict), "utf8"), "short");
  assert.equal(await client.readText(syncRoot + "/" + conflict), "a much larger remote version");
  checks += 11;
  console.log("Performance expansion: nested concurrent sync, ignore rules, unchanged cycles, and conflicts passed.");

  await client.remove(root, true);
  console.log("Performance expansion integration passed:", checks, "checks.");
} finally {
  try { await rm(local, { recursive: true, force: true }); }
  finally { database.close(); }
}
