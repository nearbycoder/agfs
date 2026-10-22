import { afterEach, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { mkdtemp, open, rm, writeFile } from "node:fs/promises";
import { getEventListeners } from "node:events";
import { AgfsClient, AgfsError, WorkflowError, ResourceLimitError, captureInventory, changeBatches, copyFile, diagnoseError, readJsonLines, readLines, stageDraft, validateInventory, walk, withRun, type Entry } from "./index.js";

const PART = 8388608;
const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const roots: string[] = [];
afterEach(async () => { vi.useRealTimers(); vi.restoreAllMocks(); for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
async function upload(client: AgfsClient, kind: string, bytes: Uint8Array) {
  if (kind === "blob") return client.upload("/file", new Blob([bytes as Uint8Array<ArrayBuffer>]));
  if (kind === "bytes") return client.upload("/file", bytes);
  if (kind === "file") {
    const root = await mkdtemp("/tmp/agfs-upload-review-"); roots.push(root); await writeFile(root + "/source", bytes);
    const file = await open(root + "/source", "r");
    try { return await client.uploadSource("/file", { size: bytes.length, read: async (start, end) => { const data = new Uint8Array(end - start); const result = await file.read(data, 0, data.length, start); return data.subarray(0, result.bytesRead); } }); }
    finally { await file.close(); }
  }
  let position = 0;
  const stream = new ReadableStream<Uint8Array>({ pull(c) { if (position === bytes.length) c.close(); else { const end = Math.min(position + 65537, bytes.length); c.enqueue(bytes.subarray(position, end)); position = end; } } }, { highWaterMark: 0 });
  return client.uploadStream("/file", stream, bytes.length);
}

it.each(["bytes", "blob", "file", "stream"].flatMap(kind => ["pending", "completing"].flatMap(status => [false, true].map(changed => ({ kind, status, changed })))))
  ("verifies every part of $kind $status resumes (changed=$changed)", async ({ kind, status, changed }) => {
    const bytes = new Uint8Array(PART + 1).fill(65); bytes[PART] = 78;
    const parts = [{ partNumber: 1, digest: sha(bytes.subarray(0, PART)) }, { partNumber: 2, digest: sha(new Uint8Array([changed ? 79 : 78])) }];
    let commits = 0; const puts: number[] = [];
    const client = new AgfsClient({ token: "fixture", retries: 0, fetch: async (url, init) => {
      const route = String(url);
      if (route.endsWith("/resumable")) return Response.json({ uploadId: "upl_review", partSize: PART, status, parts });
      if (route.includes("/parts/")) { puts.push(Number(route.split("/").at(-1))); expect(new Uint8Array(await new Response(init?.body).arrayBuffer())).toEqual(new Uint8Array([78])); return Response.json({}); }
      commits++; return Response.json({ entry: { path: "/file" } });
    } });
    if (changed && status === "completing") { await expect(upload(client, kind, bytes)).rejects.toMatchObject({ status: 409 }); expect(commits).toBe(0); }
    else { await upload(client, kind, bytes); expect(commits).toBe(1); }
    expect(puts).toEqual(changed && status === "pending" ? [2] : []);
  });

it.each(["bytes", "blob", "file", "stream"])("refuses unverifiable completing state for %s without PUT or commit", async kind => {
  const request = vi.fn(async () => Response.json({ uploadId: "upl_review", partSize: PART, status: "completing", parts: [] }));
  await expect(upload(new AgfsClient({ token: "fixture", fetch: request }), kind, new Uint8Array([1]))).rejects.toMatchObject({ status: 409 });
  expect(request).toHaveBeenCalledTimes(1);
});

it.each([-1, 0, 1])("checks exact stream length at a full-part completing boundary (%s)", async difference => {
  const bytes = new Uint8Array(PART), calls: string[] = [];
  const client = new AgfsClient({ token: "fixture", fetch: async url => { calls.push(String(url)); return String(url).endsWith("/resumable")
    ? Response.json({ uploadId: "upl_review", partSize: PART, status: "completing", parts: [{ partNumber: 1, digest: sha(bytes) }] }) : Response.json({ entry: {} }); } });
  const stream = new Blob([new Uint8Array(PART + difference)]).stream();
  if (difference) { await expect(client.uploadStream("/file", stream, PART)).rejects.toThrow("size mismatch"); expect(calls.some(p => p.endsWith("/complete"))).toBe(false); }
  else { await client.uploadStream("/file", stream, PART); expect(calls).toHaveLength(2); }
  expect(stream.locked).toBe(false);
});

it("revalidates a lost completion response without blindly restarting or retrying completion", async () => {
  const bytes = new Uint8Array(PART + 1).fill(65), saved = new Map<number, string>(); let commits = 0;
  const client = new AgfsClient({ token: "fixture", retries: 5, fetch: async (url, init) => {
    const route = String(url);
    if (route.endsWith("/resumable")) return Response.json({ uploadId: "upl_same", partSize: PART, status: commits ? "completing" : "pending", parts: [...saved].map(([partNumber, digest]) => ({ partNumber, digest })) });
    if (route.includes("/parts/")) { saved.set(Number(route.split("/").at(-1)), sha(new Uint8Array(await new Response(init?.body).arrayBuffer()))); return Response.json({}); }
    if (++commits === 1) throw new Error("Lost completion response");
    return Response.json({ entry: { path: "/file" } });
  } });
  await expect(upload(client, "stream", bytes)).rejects.toThrow("Lost completion"); expect(commits).toBe(1);
  bytes[PART] = 66; await expect(upload(client, "stream", bytes)).rejects.toMatchObject({ status: 409 }); expect(commits).toBe(1);
  bytes[PART] = 65; await upload(client, "stream", bytes); expect(commits).toBe(2); expect(saved.size).toBe(2);
});

const identity = { origin: "https://agfs.dev", account: "owner", workspace: null };
const metadata = (path: string, kind: "file" | "folder" = "file"): Entry => ({ id: "entry", path, name: path.split("/").at(-1)!, kind, size: kind === "file" ? 4 : null, etag: kind === "file" ? "v1" : null, contentType: null, updatedAt: "now" });
const who = () => Response.json({ user: { id: "owner" }, workspaceId: null });
const checkpoint = () => ({ version: 1, identity: { ...identity }, path: "/safe", since: 2, through: 9, complete: false });
it.each(["version", "identity", "path", "since", "through", "complete"])("rejects a checkpoint missing %s before any request", async field => {
  const cp: any = checkpoint(); delete cp[field]; const transport = vi.fn();
  await expect(changeBatches(new AgfsClient({ token: "fixture", fetch: transport }), "/safe", { checkpoint: cp }).next()).rejects.toThrow(); expect(transport).not.toHaveBeenCalled();
});
it.each([null, { since: -1 }, { since: 2.5 }, { since: "2" }, { through: undefined }, { through: 1 }, { through: Infinity }, { complete: true }, { complete: "false" }, { path: "/other" }, { identity: { ...identity, origin: "https://elsewhere.test" } }, { identity: { ...identity, account: "" } }, { identity: { ...identity, workspace: {} } }])
  ("rejects invalid checkpoint data before transport: %j", async patch => {
    const transport = vi.fn(); const cp = patch === null ? null : { ...checkpoint(), ...patch };
    await expect(changeBatches(new AgfsClient({ token: "fixture", fetch: transport }), "/safe", { checkpoint: cp as any }).next()).rejects.toThrow(); expect(transport).not.toHaveBeenCalled();
  });
it("snapshots a valid cursor and scope without invoking checkpoint getters or accepting wrong account bindings", async () => {
  const getter = vi.fn(() => 2), cp = checkpoint(); Object.defineProperty(cp, "since", { get: getter }); const transport = vi.fn();
  await expect(changeBatches(new AgfsClient({ token: "fixture", fetch: transport }), "/safe", { checkpoint: cp as any }).next()).rejects.toThrow(); expect(getter).not.toHaveBeenCalled(); expect(transport).not.toHaveBeenCalled();
  const request = vi.fn(async () => who()); const other = { ...checkpoint(), identity: { ...identity, account: "other" } };
  await expect(changeBatches(new AgfsClient({ token: "fixture", fetch: request }), "/safe", { checkpoint: other as any }).next()).rejects.toThrow("scope"); expect(request).toHaveBeenCalledTimes(1);
});

it.each(["consumer", "prune", "both"])("walk keeps authenticated traversal and capture independent from %s mutations", async mode => {
  const paths: string[] = [];
  const client = new AgfsClient({ token: "fixture", fetch: async url => {
    if (String(url).includes("whoami")) return who();
    const path = new URL(String(url)).searchParams.get("path")!; paths.push(path);
    return Response.json({ path, entries: path === "/safe" ? [metadata("/safe/child", "folder")] : [] });
  } });
  const prune = mode === "consumer" ? undefined : (entry: Entry) => { entry.path = "/outside"; entry.kind = "file"; return false; };
  const rows = walk(client, "/safe", { prune }); const first = (await rows.next()).value!; expect(first.path).toBe("/safe/child");
  if (mode !== "prune") { first.path = "/outside"; first.kind = "file"; }
  expect((await rows.next()).done).toBe(true); expect(paths).toEqual(["/safe", "/safe/child"]);
  paths.length = 0; const inventory = await captureInventory(client, "/safe", { prune }); expect(inventory.entries[0].path).toBe("/safe/child"); expect(paths).toEqual(["/safe", "/safe/child"]);
});

it.each([{ size: -1 }, { size: "4" }, { size: {} }, { size: null }, { etag: 123 }, { etag: "" }, { etag: null }, { etag: "x\n" }, { kind: "other" }, { path: "/elsewhere" }, { name: "elsewhere" }, { id: "" }, { id: {} }, { updatedAt: null }, { contentType: {} }])
  ("rejects malformed file metadata in both inventories and change pages: %j", async patch => {
    const value = { ...metadata("/safe/file"), ...patch };
    expect(() => validateInventory({ version: 1, identity, root: "/safe", entries: [value] })).toThrow();
    const client = new AgfsClient({ token: "fixture", fetch: async url => String(url).includes("whoami") ? who() : Response.json({ checkpoint: 1, nextCursor: null, changes: [{ seq: 1, path: "/safe/file", operation: "upsert", entry: value }] }) });
    await expect(changeBatches(client, "/safe", { since: 0 }).next()).rejects.toThrow();
  });
it.each([{}, "4", -1, NaN, undefined])("rejects malformed folder size %j", async size => {
  expect(() => validateInventory({ version: 1, identity, root: "/safe", entries: [{ ...metadata("/safe/folder", "folder"), size }] })).toThrow();
});
it("retains valid nullable folder metadata and only documented fields without invoking accessors", async () => {
  const folder: any = { ...metadata("/safe/folder", "folder"), extra: { large: true }, __proto__: null };
  for (const size of [null, 0, 42]) {
    const result = validateInventory({ version: 1, identity, root: "/safe", entries: [{ ...folder, size }] }); expect(result.entries[0]).toEqual({ ...metadata("/safe/folder", "folder"), size });
  }
  const getter = vi.fn(() => "/safe/folder"); Object.defineProperty(folder, "path", { get: getter });
  expect(() => validateInventory({ version: 1, identity, root: "/safe", entries: [folder] })).toThrow(); expect(getter).not.toHaveBeenCalled();
  const client = new AgfsClient({ token: "fixture", fetch: async url => String(url).includes("whoami") ? who() : Response.json({ checkpoint: 1, nextCursor: null, changes: [{ seq: 1, path: "/safe/folder", operation: "upsert", unknown: "discard", entry: { ...metadata("/safe/folder", "folder"), unknown: "discard" } }] }) });
  const row = (await changeBatches(client, "/safe", { since: 0 }).next()).value!;
  expect(row.changes[0]).toEqual({ seq: 1, path: "/safe/folder", operation: "upsert", entry: metadata("/safe/folder", "folder") });
});

function lineSource(text: string) {
  const bytes = new TextEncoder().encode(text); let cancelled = 0;
  const client = new AgfsClient({ token: "fixture", fetch: async url => String(url).includes("/list?") ? Response.json({ path: "/", entries: [{ ...metadata("/log"), size: bytes.length }] }) :
    new Response(new ReadableStream<Uint8Array>({ start(c) { c.enqueue(bytes); }, cancel() { cancelled++; } }, { highWaterMark: 0 }), { status: 206, headers: { etag: "v1", "content-range": "bytes 0-" + (bytes.length - 1) + "/" + bytes.length } }) });
  return { client, cancellations: () => cancelled };
}
it.each(["one\ntwo\n", "one\n\n", "one\nlast"])("closed scopes refuse all buffered line forms %j", async text => {
  const source = lineSource(text); let iterator: AsyncGenerator<any>;
  await source.client.withScope({}, async scoped => { iterator = readLines(scoped, "/log"); await iterator.next(); });
  await expect(iterator!.next()).rejects.toMatchObject({ name: "AbortError" }); expect(source.cancellations()).toBe(1); await iterator!.return(undefined);
});
it("JSONL cannot emit buffered records after expiry, and early consumer break cancels once", async () => {
  vi.useFakeTimers(); const source = lineSource("1\n2\n"); let iterator: AsyncGenerator<any>; let ready!: () => void; const started = new Promise<void>(r => { ready = r; });
  const operation = source.client.withScope({ timeoutMs: 10 }, async scoped => { iterator = readJsonLines(scoped, "/log"); await iterator.next(); ready(); await new Promise(() => {}); }).catch(error => error);
  await started; await vi.advanceTimersByTimeAsync(10); expect(diagnoseError(await operation).category).toBe("timeout");
  await expect(iterator!.next()).rejects.toMatchObject({ name: "TimeoutError" }); expect(source.cancellations()).toBe(1); expect(vi.getTimerCount()).toBe(0);
  const early = lineSource("1\n2\n"); await early.client.withScope({}, async scoped => { for await (const row of readJsonLines(scoped, "/log")) { expect(row.value).toBe(1); break; } }); expect(early.cancellations()).toBe(1);
});

it.each(["draft", "run"].flatMap(kind => ["budget", "timeout", "cancelled", "conflict"].map(mode => ({ kind, mode }))))
  ("scope retains acknowledged $kind recovery state on $mode", async ({ kind, mode }) => {
    vi.useFakeTimers(); const controller = new AbortController(), reason = { user: "stop" }; let changes = 0, ready!: () => void;
    const started = new Promise<void>(r => { ready = r; });
    const client = new AgfsClient({ token: "fixture", retries: 0, fetch: async (url, init) => {
      const route = String(url);
      if (route.endsWith("/drafts") || route.endsWith("/runs")) return Response.json({ id: kind + "_recover" });
      if (kind === "draft" && ++changes === 1) return Response.json({});
      if (mode === "cancelled") { controller.abort(reason); throw init!.signal!.reason; }
      if (mode === "timeout") { ready(); return new Promise<Response>(() => {}); }
      if (mode === "conflict") return Response.json({ error: "changed" }, { status: 412 });
      throw new Error("Budget must stop before this request");
    } });
    const operation = client.withScope({ maxRequests: mode === "budget" ? kind === "draft" ? 2 : 1 : 10, timeoutMs: 10, signal: controller.signal }, scoped => kind === "draft"
      ? stageDraft(scoped, { name: "review", path: "/", changes: [{ path: "/a", operation: "write", content: "a" }, { path: "/b", operation: "write", content: "b" }] })
      : withRun(scoped, "job", "/", async () => 1)).catch(error => error);
    if (mode === "timeout") { await started; await vi.advanceTimersByTimeAsync(10); }
    const failure = await operation;
    expect(diagnoseError(failure)).toMatchObject({ category: mode, resourceId: kind + "_recover", completed: kind === "draft" ? 1 : 0 });
    if (mode === "cancelled") { let cause: any = failure; while (cause?.cause !== undefined) cause = cause.cause; expect(cause).toBe(reason); }
    expect(getEventListeners(controller.signal, "abort")).toHaveLength(0); expect(vi.getTimerCount()).toBe(0);
  });
it("deadline journals concurrent known runs without waiting for uncooperative callbacks", async () => {
  vi.useFakeTimers(); let ids = 0, begun = 0, ready!: () => void; const started = new Promise<void>(r => { ready = r; });
  const client = new AgfsClient({ token: "fixture", fetch: async () => Response.json({ id: "run_" + ++ids }) });
  const operation = client.withScope({ timeoutMs: 10 }, scoped => Promise.all([1, 2].map(() => withRun(scoped, "job", "/", async () => { if (++begun === 2) ready(); return new Promise(() => {}); })))).catch(error => error);
  await started; await vi.advanceTimersByTimeAsync(10);
  expect(diagnoseError(await operation)).toMatchObject({ category: "timeout", resources: [{ kind: "run", resourceId: "run_1", completed: 0 }, { kind: "run", resourceId: "run_2", completed: 0 }] }); expect(vi.getTimerCount()).toBe(0);
});
it("outer scopes retain nested workflow recovery and clear completed workflow records", async () => {
  const controller = new AbortController(); const client = new AgfsClient({ token: "fixture", fetch: async () => Response.json({ id: "run_nested" }) });
  const error = await client.withScope({ signal: controller.signal }, outer => outer.withScope({}, inner => withRun(inner, "job", "/", async () => { controller.abort(); return new Promise(() => {}); }))).catch(error => error);
  expect(diagnoseError(error)).toMatchObject({ category: "cancelled", resourceId: "run_nested" });
  const completed = await client.withScope({}, async scoped => { await withRun(scoped, "job", "/", async () => 1); throw new Error("unrelated"); }).catch(error => error);
  expect(diagnoseError(completed).resourceId).toBeUndefined(); expect(getEventListeners(controller.signal, "abort")).toHaveLength(0);
});
it("decodes existing change-log epoch timestamps without relaxing other metadata validation", async () => {
  const epoch = 1792670400000;
  const client = new AgfsClient({ token: "fixture", fetch: async url => String(url).includes("whoami") ? who() : Response.json({ checkpoint: 1, nextCursor: null, changes: [{ seq: 1, path: "/safe/file", operation: "upsert", entry: { ...metadata("/safe/file"), updatedAt: epoch } }] }) });
  expect((await changeBatches(client, "/safe", { since: 0 }).next()).value!.changes[0].entry!.updatedAt).toBe(new Date(epoch).toISOString());
});
it("stream copy refuses different completing-session content and releases its source reader", async () => {
  const bytes = new Uint8Array(PART + 1); let cancels = 0, commits = 0;
  const stream = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(bytes); c.close(); }, cancel() { cancels++; } }, { highWaterMark: 0 });
  const source = new AgfsClient({ token: "source", fetch: async (url, init) => {
    if (String(url).includes("/list?")) return Response.json({ path: "/", entries: [{ ...metadata("/source"), size: bytes.length }] });
    expect(new Headers(init?.headers).get("if-match")).toBe("v1");
    return new Response(stream);
  } });
  const destination = new AgfsClient({ token: "destination", fetch: async url => {
    if (String(url).endsWith("/resumable")) return Response.json({ uploadId: "upl_old", partSize: PART, status: "completing", parts: [{ partNumber: 1, digest: sha(bytes.subarray(0, PART)) }, { partNumber: 2, digest: sha(new Uint8Array([1])) }] });
    commits++; return Response.json({});
  } });
  await expect(copyFile(source, destination, "/source", "/target")).rejects.toMatchObject({ status: 409 }); expect(commits).toBe(0);
  // A fully consumed closed stream needs no producer cancellation callback.
  expect(cancels).toBe(0); expect(stream.locked).toBe(false);
});
it("a retained iterator cannot resume after yielding its final unterminated line inside a closed scope", async () => {
  const client = new AgfsClient({ token: "fixture", fetch: async url => String(url).includes("/list?") ? Response.json({ path: "/", entries: [metadata("/log")] }) : new Response("last", { status: 206, headers: { etag: "v1", "content-range": "bytes 0-3/4" } }) });
  let iterator: AsyncGenerator<any>;
  await client.withScope({}, async scoped => { iterator = readLines(scoped, "/log"); expect((await iterator.next()).value.text).toBe("last"); });
  await expect(iterator!.next()).rejects.toMatchObject({ name: "AbortError" });
});

function resumeFixture(text = "one\ntwo\n") {
  const bytes = new TextEncoder().encode(text);
  const fetcher = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    if (String(url).includes("/list?")) return Response.json({ path: "/", entries: [{ ...metadata("/log"), size: bytes.length }] });
    const [start, end] = new Headers(init?.headers).get("range")!.slice(6).split("-").map(Number);
    return new Response(bytes.slice(start, end + 1), { status: 206, headers: { etag: "v1", "content-range": `bytes ${start}-${end}/${bytes.length}` } });
  });
  return { client: new AgfsClient({ token: "fixture", fetch: fetcher }), fetcher };
}
it.each(["version", "origin", "path", "etag", "offset", "line"])("requires emitted line checkpoint field %s before transport", async field => {
  const { client, fetcher } = resumeFixture(), rows = readLines(client, "/log");
  const cp: any = { ...(await rows.next()).value!.checkpoint }; await rows.return(); delete cp[field]; fetcher.mockClear();
  await expect(readLines(client, "/log", { checkpoint: cp }).next()).rejects.toBeInstanceOf(TypeError);
  await expect(readJsonLines(client, "/log", { checkpoint: cp }).next()).rejects.toBeInstanceOf(TypeError);
  expect(fetcher).not.toHaveBeenCalled();
});
it.each([
  ["version", true], ["origin", 1], ["path", "/other"], ["etag", 1], ["etag", ""], ["etag", "x\n"], ["etag", "x".repeat(257)],
  ["offset", undefined], ["offset", -1], ["offset", 1.5], ["offset", 20 * 1024 ** 3 + 1], ["offset", 0],
  ["line", null], ["line", false], ["line", 0], ["line", 5], ["line", Number.MAX_SAFE_INTEGER + 1],
])("rejects invalid line checkpoint %s=%s without transport", async (field, value) => {
  const { client, fetcher } = resumeFixture();
  const cp: any = { version: 1, origin: client.baseUrl, path: "/log", etag: "v1", offset: 4, line: 1, [field as string]: value };
  await expect(readLines(client, "/log", { checkpoint: cp }).next()).rejects.toBeInstanceOf(TypeError); expect(fetcher).not.toHaveBeenCalled();
});
it("does not read checkpoint accessors or inherited fields and rejects explicit null", async () => {
  const { client, fetcher } = resumeFixture(), getter = vi.fn(() => 4);
  const cp = { version: 1, origin: client.baseUrl, path: "/log", etag: "v1", line: 1 };
  for (const value of [null, Object.assign(Object.create({ offset: 4 }), cp), Object.defineProperty({ ...cp }, "offset", { get: getter, enumerable: true })]) {
    await expect(readLines(client, "/log", { checkpoint: value as any }).next()).rejects.toBeInstanceOf(TypeError);
  }
  expect(getter).not.toHaveBeenCalled(); expect(fetcher).not.toHaveBeenCalled();
});
it("snapshots line checkpoints before metadata awaits and revalidates valid EOF without downloading", async () => {
  const { client, fetcher } = resumeFixture("\uFEFFé😀\r\nlast\r"), rows = readLines(client, "/log");
  const first = (await rows.next()).value!; expect(first.text).toBe("é😀"); await rows.return();
  const cp = { ...first.checkpoint }, request = fetcher.getMockImplementation()!;
  fetcher.mockImplementationOnce(async (url, init) => { cp.offset = 0; cp.line = 0; cp.etag = "tampered"; return request(url, init); });
  const remaining = []; for await (const row of readLines(client, "/log", { checkpoint: cp })) remaining.push(row);
  expect(remaining.map(row => [row.text, row.line])).toEqual([["last\r", 2]]);
  fetcher.mockClear(); expect((await readLines(client, "/log", { checkpoint: remaining[0].checkpoint }).next()).done).toBe(true);
  expect(fetcher).toHaveBeenCalledTimes(1); expect(String(fetcher.mock.calls[0][0])).toContain("/list?");
});
it.each(["conflict", "budget", "cancelled", "timeout"])("preserves %s and every acknowledged ID through six nested runs", async mode => {
  const controller = new AbortController(); let ids = 0, callbacks = 0;
  const fetcher = vi.fn(async () => Response.json({ id: "nested_" + ++ids }));
  const client = new AgfsClient({ token: "fixture", fetch: fetcher });
  const nested = (scoped: AgfsClient, depth: number): Promise<unknown> => withRun(scoped, "nested", "/", async () => {
    callbacks++; if (depth) return nested(scoped, depth - 1);
    if (mode === "conflict") throw new AgfsError(412, "changed");
    if (mode === "cancelled") controller.abort(new AgfsError(412, "caller reason"));
    if (mode === "timeout") throw new DOMException("deadline", "TimeoutError");
    return 1;
  });
  const failure = await client.withScope({ maxRequests: 6, signal: controller.signal }, scoped => nested(scoped, 5)).catch(error => error);
  const result = diagnoseError(failure);
  expect(result.category).toBe(mode); expect(result.exitCode).toBe(({ conflict: 5, budget: 8, cancelled: 130, timeout: 124 })[mode]);
  expect(result.resources?.map(item => item.resourceId).sort()).toEqual(Array.from({ length: 6 }, (_, i) => "nested_" + (i + 1)));
  expect(result.resources?.every(item => item.kind === "run" && item.completed === 0)).toBe(true);
  expect(callbacks).toBe(6); expect(fetcher).toHaveBeenCalledTimes(6); expect(getEventListeners(controller.signal, "abort")).toHaveLength(0);
});
it("classifies very deep workflow causes without recursion and deduplicates confirmed progress", () => {
  let error: unknown = new ResourceLimitError("limit");
  for (let i = 0; i < 10000; i++) error = new WorkflowError("wrapped", "same_draft", i % 3, error);
  expect(diagnoseError(error)).toMatchObject({ category: "budget", exitCode: 8, resources: [{ resourceId: "same_draft", completed: 2 }] });
});
it("terminates cause cycles, preserves distinct known resources, and never invokes dynamic cause getters", () => {
  const a = new WorkflowError("a", "draft_a", 1, undefined), b = new WorkflowError("b", "run_b", 0, a); a.cause = b;
  expect(diagnoseError(a)).toMatchObject({ category: "failure", resources: [{ resourceId: "draft_a", completed: 1 }, { resourceId: "run_b", completed: 0 }] });
  const conflict = new AgfsError(412, "changed"); Object.assign(conflict, { cause: a }); a.cause = conflict;
  expect(diagnoseError(a)).toMatchObject({ category: "conflict", status: 412, exitCode: 5 });
  const getter = vi.fn(() => new Error("generated forever")), error = Object.defineProperty(new Error("opaque"), "cause", { get: getter });
  expect(diagnoseError(error).category).toBe("failure"); expect(getter).not.toHaveBeenCalled();
});

// Exercise native fetch's content decoding without sockets, Workers or network.
// Both dispatcher handler shapes are supported across the SDK's Node versions.
function negotiatedDownload(bytes: Uint8Array, identityHeader?: string, forceGzip = false) {
  const requests: Headers[] = [];
  const dispatcher = { dispatch(options: any, handler: any) {
    const sent = Array.isArray(options.headers)
      ? new Headers(Array.from({ length: options.headers.length / 2 }, (_, i) => [options.headers[i * 2], options.headers[i * 2 + 1]] as [string, string]))
      : new Headers(options.headers);
    requests.push(sent);
    const gzip = forceGzip || sent.get("accept-encoding") !== "identity", wire = gzip ? gzipSync(bytes) : bytes;
    const headers = { "content-length": String(wire.length), etag: "v1", ...(gzip ? { "content-encoding": "gzip" } : identityHeader ? { "content-encoding": identityHeader } : {}) };
    const rawHeaders = Object.entries(headers).flatMap(([name, value]) => [Buffer.from(name), Buffer.from(value)]);
    const controller = { rawHeaders, pause() {}, resume() {}, abort(reason: unknown) { handler.onResponseError?.(controller, reason); } };
    queueMicrotask(() => {
      if (handler.onRequestStart) {
        handler.onRequestStart(controller); handler.onResponseStart(controller, 200, headers, "OK");
        handler.onResponseData(controller, wire); handler.onResponseEnd(controller, {});
      } else {
        handler.onConnect((reason: unknown) => handler.onError(reason)); handler.onHeaders(200, rawHeaders, () => {}, "OK");
        handler.onData(wire); handler.onComplete([]);
      }
    });
    return true;
  } };
  return { requests, fetch: (input: Parameters<typeof fetch>[0], init?: RequestInit) => fetch(input, { ...init, dispatcher } as RequestInit) };
}
it("native fetch decodes gzip while retaining encoded headers (controlled transport)", async () => {
  const bytes = new TextEncoder().encode("雪🌱\r\nsecond\nfinal\r"), transport = negotiatedDownload(bytes);
  const response = await transport.fetch("https://controlled.invalid/source");
  expect(transport.requests[0].get("accept-encoding")).toContain("gzip");
  expect(response.headers.get("content-encoding")).toBe("gzip");
  expect(Number(response.headers.get("content-length"))).toBe(gzipSync(bytes).length);
  expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);
});
it.each([undefined, "identity", "Identity"])("copy negotiates source-only identity and streams exact bytes (response coding %s)", async coding => {
  const bytes = new TextEncoder().encode("雪🌱\r\nsecond\nfinal\r"), transport = negotiatedDownload(bytes, coding);
  const sourceFetch = vi.fn(async (input: any, init?: RequestInit) => {
    expect(new Headers(init?.headers).get("authorization")).toBe("Bearer source");
    expect(new URL(String(input)).origin).toBe("https://source.invalid");
    if (String(input).includes("/list?")) { expect(new Headers(init?.headers).has("accept-encoding")).toBe(false); return Response.json({ path: "/", entries: [{ ...metadata("/source"), size: bytes.length }] }); }
    return transport.fetch(input, init);
  });
  const destinationFetch = vi.fn(async (input: any, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    expect(new URL(String(input)).origin).toBe("https://destination.invalid");
    expect(headers.get("authorization")).toBe("Bearer destination"); expect(headers.has("accept-encoding")).toBe(false);
    if (String(input).endsWith("/resumable")) { expect(JSON.parse(init!.body as string)).toMatchObject({ size: bytes.length, ifMatch: null }); return Response.json({ uploadId: "upl_copy", partSize: PART, status: "pending", parts: [] }); }
    if (String(input).includes("/parts/")) { expect(new Uint8Array(await new Response(init!.body).arrayBuffer())).toEqual(bytes); return Response.json({}); }
    return Response.json({ entry: { ...metadata("/target"), size: bytes.length } });
  });
  const source = new AgfsClient({ token: "source", baseUrl: "https://source.invalid", retries: 5, fetch: sourceFetch });
  const destination = new AgfsClient({ token: "destination", baseUrl: "https://destination.invalid", retries: 5, fetch: destinationFetch });
  await source.withScope({ maxRequests: 2 }, scopedSource => destination.withScope({ maxRequests: 3 }, scopedDestination => copyFile(scopedSource, scopedDestination, "/source", "/target")));
  expect(sourceFetch).toHaveBeenCalledTimes(2); expect(destinationFetch).toHaveBeenCalledTimes(3);
  expect(transport.requests).toHaveLength(1); expect(transport.requests[0].get("accept-encoding")).toBe("identity"); expect(transport.requests[0].get("if-match")).toBe("v1");
});
it.each(["gzip", "br", "identity, gzip", ""])("copy still refuses nonidentity coding %s and cancels before destination requests", async coding => {
  const cancel = vi.fn(), body = new ReadableStream<Uint8Array>({ cancel }, { highWaterMark: 0 });
  const sourceFetch = vi.fn(async (input: any) => String(input).includes("/list?") ? Response.json({ path: "/", entries: [metadata("/source")] }) : new Response(body, { headers: { "content-encoding": coding, "content-length": "1" } }));
  const destinationFetch = vi.fn();
  await expect(copyFile(new AgfsClient({ token: "source", retries: 5, fetch: sourceFetch }), new AgfsClient({ token: "destination", fetch: destinationFetch }), "/source", "/target")).rejects.toThrow("unencoded");
  expect(sourceFetch).toHaveBeenCalledTimes(2); expect(destinationFetch).not.toHaveBeenCalled(); expect(cancel).toHaveBeenCalledTimes(1); expect(body.locked).toBe(false);
});
it("copy refuses gzip even when native fetch already decoded an ignored identity request", async () => {
  const bytes = new TextEncoder().encode("雪🌱\r\nsecond\nfinal\r"), transport = negotiatedDownload(bytes, undefined, true);
  let response!: Response;
  const source = new AgfsClient({ token: "source", fetch: async (input, init) => {
    if (String(input).includes("/list?")) return Response.json({ path: "/", entries: [{ ...metadata("/source"), size: bytes.length }] });
    response = await transport.fetch(input, init); return response;
  } });
  const destinationFetch = vi.fn();
  await expect(copyFile(source, new AgfsClient({ token: "destination", fetch: destinationFetch }), "/source", "/target")).rejects.toThrow("unencoded");
  expect(transport.requests[0].get("accept-encoding")).toBe("identity"); expect(destinationFetch).not.toHaveBeenCalled();
  expect(response.body!.locked).toBe(false);
  const reader = response.body!.getReader(); try { expect((await reader.read()).done).toBe(true); } finally { reader.releaseLock(); }
});
it.each([3, 5])("identity copy rejects %s actual bytes against four listed bytes regardless of Content-Length", async size => {
  const source = new AgfsClient({ token: "source", fetch: async input => String(input).includes("/list?")
    ? Response.json({ path: "/", entries: [metadata("/source")] })
    : new Response(new Uint8Array(size), { headers: { "content-encoding": "identity", "content-length": "4" } }) });
  const destinationFetch = vi.fn();
  await expect(copyFile(source, new AgfsClient({ token: "destination", fetch: destinationFetch }), "/source", "/target")).rejects.toThrow("size mismatch");
  expect(destinationFetch).not.toHaveBeenCalled();
});
it("identity copy counts one retried source GET against the same request budget", async () => {
  vi.useFakeTimers(); const bytes = new Uint8Array([1, 2, 3, 4]), transport = negotiatedDownload(bytes);
  let attempts = 0, ready!: () => void; const retrying = new Promise<void>(resolve => { ready = resolve; });
  const sourceFetch = vi.fn(async (input: any, init?: RequestInit) => {
    if (String(input).includes("/list?")) return Response.json({ path: "/", entries: [metadata("/source")] });
    expect(new Headers(init?.headers).get("accept-encoding")).toBe("identity");
    if (++attempts === 1) { ready(); return Response.json({ error: "temporarily unavailable" }, { status: 503 }); }
    return transport.fetch(input, init);
  });
  const destinationFetch = vi.fn(async (input: any) => String(input).endsWith("/resumable")
    ? Response.json({ uploadId: "upl_copy", partSize: PART, status: "pending", parts: [] }) : Response.json({ entry: metadata("/target") }));
  const source = new AgfsClient({ token: "source", retries: 1, fetch: sourceFetch }), destination = new AgfsClient({ token: "destination", fetch: destinationFetch });
  const operation = source.withScope({ maxRequests: 3 }, scoped => copyFile(scoped, destination, "/source", "/target"));
  await retrying; await vi.advanceTimersByTimeAsync(250); await operation;
  expect(sourceFetch).toHaveBeenCalledTimes(3); expect(destinationFetch).toHaveBeenCalledTimes(3); expect(vi.getTimerCount()).toBe(0);
});
