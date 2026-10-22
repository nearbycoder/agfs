import { afterEach, expect, it, vi } from "vitest";
import { createHmac, createHash } from "node:crypto";
import { getEventListeners } from "node:events";
import { AgfsClient, AgfsError, captureInventory, changeBatches, compareInventories, copyFile, diagnoseError, mergeJsonPatch, publishText, readJsonLines, readLines, ResourceLimitError, stageDraft, transformJson, verifyWebhook, walk, withRun, type Entry, type LineCheckpoint } from "./index";

afterEach(() => vi.useRealTimers());
const entry = (path: string, size = 4, etag = "revision", kind: "file" | "folder" = "file"): Entry => ({ id: path, name: path.split("/").at(-1)!, path, kind, size: kind === "file" ? size : null, etag: kind === "file" ? etag : null, contentType: "text/plain", updatedAt: "now" });
const client = (transport: typeof fetch) => new AgfsClient({ token: "fixture", fetch: transport, retries: 0 });
const collect = async <T>(values: AsyncIterable<T>) => { const result: T[] = []; for await (const item of values) result.push(item); return result; };
const identity = { origin: "https://agfs.dev", account: "fixture-account", workspace: null };
const who = () => Response.json({ user: { id: identity.account }, workspaceId: null });

it("#105 walk prunes folders, stays pull-driven, rejects scope escapes and enforces discovery limits", async () => {
  const fetcher = vi.fn(async (url: any) => {
    const path = new URL(String(url)).searchParams.get("path");
    return Response.json({ path, entries: path === "/" ? [entry("/a", 0, "", "folder"), entry("/b", 0, "", "folder")] : [entry(`${path}/file`)] });
  });
  for await (const _item of walk(client(fetcher), "/")) break;
  expect(fetcher).toHaveBeenCalledTimes(1);
  const results = await collect(walk(client(fetcher), "/", { prune: e => e.path === "/b" }));
  expect(results.map(e => e.path)).toEqual(["/a", "/a/file"]);
  await expect(collect(walk(client(fetcher), "/", { maxEntries: 1 }))).rejects.toBeInstanceOf(ResourceLimitError);
  await expect(collect(walk(client(async () => Response.json({ path: "/safe", entries: [entry("/outside")] })), "/safe"))).rejects.toThrow("entry path");
});

it("#106–107 captures deterministic scoped inventories and compares offline without content requests", async () => {
  const fetcher = vi.fn(async (url: any) => String(url).includes("whoami") ? who() : Response.json({ path: "/", entries: [entry("/z"), entry("/a")] }));
  const before = await captureInventory(client(fetcher), "/");
  expect(before.entries.map(e => e.path)).toEqual(["/a", "/z"]); expect(fetcher).toHaveBeenCalledTimes(2);
  const after = { ...before, entries: [entry("/a", 4, "new"), entry("/b")] };
  expect(compareInventories(before, after).map(d => [d.path, d.status])).toEqual([["/a", "changed"], ["/b", "added"], ["/z", "removed"]]);
  expect(() => compareInventories(before, { ...after, identity: { ...identity, account: "other" } })).toThrow("different scopes");
  expect(fetcher).toHaveBeenCalledTimes(2);
});

it("#109 copies between isolated clients with pinned read and create-only write", async () => {
  const sourceFetch = vi.fn(async (url: any, init: any) => {
    expect(init.headers.get("authorization")).toBe("Bearer source");
    if (String(url).includes("list")) return Response.json({ path: "/", entries: [entry("/source")] });
    expect(init.headers.get("if-match")).toBe("revision"); return new Response("data");
  });
  const destinationFetch = vi.fn(async (url: any, init: any) => {
    expect(init.headers.get("authorization")).toBe("Bearer destination");
    if (String(url).endsWith("/resumable")) { expect(JSON.parse(init.body)).toMatchObject({ path: "/target", ifMatch: null, size: 4 }); return Response.json({ uploadId: "upl_copy", partSize: 8388608, status: "pending", parts: [] }); }
    if (String(url).includes("/parts/")) { expect(await new Response(init.body).text()).toBe("data"); return new Response(null); }
    return Response.json({ entry: entry("/target") });
  });
  await copyFile(new AgfsClient({ token: "source", fetch: sourceFetch }), new AgfsClient({ token: "destination", fetch: destinationFetch }), "/source", "/target");
  expect(sourceFetch).toHaveBeenCalledTimes(2); expect(destinationFetch).toHaveBeenCalledTimes(3);
  await expect(copyFile(new AgfsClient({ token: "source", fetch: sourceFetch }), new AgfsClient({ token: "destination", fetch: destinationFetch }), "/source", "/target", { maxBytes: 3 })).rejects.toBeInstanceOf(ResourceLimitError);
  expect(sourceFetch).toHaveBeenCalledTimes(3); expect(destinationFetch).toHaveBeenCalledTimes(3);
});

function lineClient(text: string, chunks = 1, override?: (response: Response) => Response) {
  const bytes = new TextEncoder().encode(text), cancelled = vi.fn();
  const transport = vi.fn(async (url: any, init: any) => {
    if (String(url).includes("list")) return Response.json({ path: "/", entries: [entry("/log", bytes.length)] });
    expect(init.headers.get("if-match")).toBe("revision");
    const [, start, end] = /bytes=(\d+)-(\d+)/.exec(init.headers.get("range"))!;
    let offset = Number(start); const limit = Math.min(Number(end) + 1, bytes.length);
    const body = new ReadableStream<Uint8Array>({ pull(c) { if (offset >= limit) { c.close(); return; } c.enqueue(bytes.slice(offset, offset + Math.min(chunks, limit - offset))); offset += Math.min(chunks, limit - offset); }, cancel: cancelled });
    const response = new Response(body, { status: 206, headers: { etag: "revision", "content-range": `bytes ${start}-${limit - 1}/${bytes.length}` } });
    return override ? override(response) : response;
  });
  return { client: client(transport), transport, cancelled };
}
it("#110 resumes complete UTF-8/CRLF lines at exact byte boundaries and cancels early consumption", async () => {
  const fixture = lineClient("é😀\r\nsecond\nlast", 1), iterator = readLines(fixture.client, "/log");
  const first = (await iterator.next()).value!;
  expect(first.text).toBe("é😀"); expect(first.checkpoint.offset).toBe(8);
  await iterator.return(); expect(fixture.cancelled).toHaveBeenCalledTimes(1);
  const remaining = await collect(readLines(fixture.client, "/log", { checkpoint: first.checkpoint }));
  expect(remaining.map(v => [v.text, v.line])).toEqual([["second", 2], ["last", 3]]);
  expect(fixture.transport.mock.calls[3][1].headers.get("range")).toBe("bytes=7-18");
});
it("#110 rejects forged boundaries, stale ETags, oversized lines, truncation and ignored ranges", async () => {
  const fixture = lineClient("abc\ndef\n");
  const checkpoint: LineCheckpoint = { version: 1, origin: identity.origin, path: "/log", etag: "revision", offset: 2, line: 1 };
  await expect(collect(readLines(fixture.client, "/log", { checkpoint }))).rejects.toThrow("line boundary");
  await expect(collect(readLines(fixture.client, "/log", { checkpoint: { ...checkpoint, etag: "changed" } }))).rejects.toMatchObject({ status: 412 });
  await expect(collect(readLines(fixture.client, "/log", { maxLineBytes: 2 }))).rejects.toThrow("maxLineBytes");
  await expect(collect(readLines(fixture.client, "/log", { maxBytes: 4 }))).rejects.toThrow("maxBytes");
  const ignored = lineClient("abc", 3, response => new Response(response.body));
  await expect(collect(readLines(ignored.client, "/log"))).rejects.toThrow("ranged response"); expect(ignored.cancelled).toHaveBeenCalled();
  const short = lineClient("abc", 3, response => new Response("a", { status: 206, headers: response.headers }));
  await expect(collect(readLines(short.client, "/log"))).rejects.toThrow("Truncated");
});
it("#111 emits validated records, reports exact malformed line and enforces record budgets", async () => {
  const fixture = lineClient('{"value":"é"}\nnull\nnope\n', 2);
  const iterator = readJsonLines(fixture.client, "/log");
  expect((await iterator.next()).value!.value).toEqual({ value: "é" }); expect((await iterator.next()).value!.value).toBeNull();
  await expect(iterator.next()).rejects.toMatchObject({ name: "JsonLineError", line: 3 });
  await expect(collect(readJsonLines(lineClient("1\n2\n").client, "/log", { maxRecords: 1 }))).rejects.toThrow("maxRecords");
});
it("#110–111 preserve bare final CR, reject malformed UTF-8/non-finite JSON and stop after consumer failure", async () => {
  expect((await collect(readLines(lineClient("\uFEFFfirst\nlast\r").client, "/log"))).map(row => row.text)).toEqual(["first", "last\r"]);
  const invalid = lineClient("xx", 2, response => new Response(new Uint8Array([0xc3, 0x28]), { status: 206, headers: response.headers }));
  await expect(collect(readLines(invalid.client, "/log"))).rejects.toThrow();
  await expect(collect(readJsonLines(lineClient("1e999\n").client, "/log"))).rejects.toMatchObject({ name: "JsonLineError", line: 1 });
  const fixture = lineClient("1\n2\n", 1), iterator = readJsonLines(fixture.client, "/log"); await iterator.next();
  await iterator.return(); expect(fixture.cancelled).toHaveBeenCalledTimes(1);
});
it("#112 skips identical text without upload and uses exact create/update conditions", async () => {
  const c = client(async url => String(url).includes("list") ? Response.json({ path: "/", entries: [entry("/text")] }) : new Response("same"));
  const upload = vi.spyOn(c, "upload").mockResolvedValue(entry("/text"));
  expect((await publishText(c, "/text", "same")).changed).toBe(false); expect(upload).not.toHaveBeenCalled();
  await publishText(c, "/text", "new"); expect(upload.mock.calls[0][2]).toMatchObject({ ifMatch: "revision" });
  const empty = client(async () => Response.json({ path: "/", entries: [] })); const create = vi.spyOn(empty, "upload").mockResolvedValue(entry("/new"));
  await publishText(empty, "/new", ""); expect(create.mock.calls[0][2]).toMatchObject({ ifMatch: null });
});
it("#113 preserves null semantics and rejects lossy JSON without writes or callback retries", async () => {
  expect(mergeJsonPatch({ keep: 1, remove: 2 }, { remove: null, nested: { value: null, added: 3 } })).toEqual({ keep: 1, nested: { added: 3 } });
  expect(mergeJsonPatch({ a: 1 }, null)).toBeNull();
  const c = client(async url => String(url).includes("list") ? Response.json({ path: "/", entries: [entry("/json", 7)] }) : new Response('{"a":1}'));
  const upload = vi.spyOn(c, "upload").mockRejectedValue(new AgfsError(409, "changed")); const callback = vi.fn(() => ({ a: 2 }));
  await expect(transformJson(c, "/json", callback)).rejects.toMatchObject({ status: 409 }); expect(callback).toHaveBeenCalledTimes(1); expect(upload).toHaveBeenCalledTimes(1);
  upload.mockClear(); await expect(transformJson(c, "/json", () => ({ a: undefined }) as any)).rejects.toThrow("exactly"); expect(upload).not.toHaveBeenCalled();
  expect((await transformJson(c, "/json", value => value)).changed).toBe(false);
});
it("#114 resumes fixed-through pages and advances complete windows without polling", async () => {
  const requests: string[] = [];
  const c = client(async url => {
    if (String(url).includes("whoami")) return who(); requests.push(String(url));
    return Response.json(requests.length === 1 ? { checkpoint: 9, nextCursor: 3, changes: [{ seq: 3, path: "/a", operation: "upsert", entry: entry("/a") }] }
      : { checkpoint: 9, nextCursor: null, changes: [] });
  });
  const first = changeBatches(c, "/", { since: 0 }); const batch = (await first.next()).value!; await first.return();
  const rest = await collect(changeBatches(c, "/", { checkpoint: batch.checkpoint }));
  expect(requests.map(url => new URL(url).search)).toEqual(["?path=%2F&since=0", "?path=%2F&since=3&through=9"]); expect(rest[0].checkpoint).toMatchObject({ since: 9, through: 9, complete: true });
  await expect(collect(changeBatches(c, "/other", { checkpoint: batch.checkpoint }))).rejects.toThrow("another scope");
});
it("#115 counts retry and empty-upload capability attempts, rejects callbacks/preabort and closes retained clients", async () => {
  vi.useFakeTimers(); const transport = vi.fn(async () => Response.json({ error: "busy" }, { status: 503 }));
  const c = new AgfsClient({ token: "fixture", fetch: transport });
  const operation = c.withScope({ maxRequests: 2 }, async scoped => scoped.whoami()); const rejected = expect(operation).rejects.toBeInstanceOf(ResourceLimitError);
  await vi.runAllTimersAsync(); await rejected; expect(transport).toHaveBeenCalledTimes(2);
  let retained!: AgfsClient; await c.withScope({}, async scoped => { retained = scoped; });
  await expect(retained.whoami()).rejects.toMatchObject({ name: "AbortError" }); expect(transport).toHaveBeenCalledTimes(2);
  await expect(new AgfsClient({ token: async () => "x", fetch: transport }).withScope({}, async scoped => scoped.whoami())).rejects.toThrow("static token");
  await expect(c.withScope({ signal: AbortSignal.abort("stop") }, async scoped => scoped.whoami())).rejects.toMatchObject({ name: "AbortError" }); expect(transport).toHaveBeenCalledTimes(2);
  const emptyFetch = vi.fn(async (url: any) => String(url).endsWith("/upload-intents") ? Response.json({ uploadId: "upl_empty", url: "https://agfs.dev/api/v1/fs/uploads/upl_empty/blob", headers: {} }) : new Response(null));
  await expect(client(emptyFetch).withScope({ maxRequests: 2 }, scoped => scoped.upload("/empty", new Uint8Array()))).rejects.toBeInstanceOf(ResourceLimitError);
  expect(emptyFetch).toHaveBeenCalledTimes(2); expect(vi.getTimerCount()).toBe(0);
});
it("#115 cancels owned readers on scope exit and deadline; #116 distinguishes budgets/deadlines/conflicts", async () => {
  vi.useFakeTimers(); const cancel = vi.fn(), c = client(async () => new Response(new ReadableStream({ cancel })));
  await c.withScope({}, async scoped => { await scoped.download("/x"); }); expect(cancel).toHaveBeenCalledTimes(1);
  const operation = c.withScope({ timeoutMs: 20 }, async scoped => (await scoped.download("/x")).text());
  const rejected = expect(operation).rejects.toMatchObject({ name: "TimeoutError" }); await vi.advanceTimersByTimeAsync(20); await rejected;
  expect(cancel).toHaveBeenCalledTimes(2); expect(vi.getTimerCount()).toBe(0);
  expect(diagnoseError(new ResourceLimitError("limit"))).toMatchObject({ category: "budget", exitCode: 8 });
  expect(diagnoseError(new DOMException("deadline", "TimeoutError"))).toMatchObject({ category: "timeout", exitCode: 124 });
  expect(diagnoseError(new AgfsError(412, "changed"))).toMatchObject({ category: "conflict", exitCode: 5, retryable: false });
});
it("#115 nested budgets cannot bypass outer limits and external cancellation removes listeners", async () => {
  vi.useFakeTimers(); const transport = vi.fn(async () => Response.json({ ok: true })), outer = new AgfsClient({ token: "fixture", fetch: transport });
  await expect(outer.withScope({ maxRequests: 1 }, scoped => scoped.withScope({ maxRequests: 2 }, async nested => { await nested.whoami(); await nested.whoami(); }))).rejects.toBeInstanceOf(ResourceLimitError);
  expect(transport).toHaveBeenCalledTimes(1);
  const controller = new AbortController(), bodyCancel = vi.fn();
  const c = new AgfsClient({ token: "fixture", fetch: async () => new Response(new ReadableStream({ cancel: bodyCancel })) });
  const result = c.withScope({ signal: controller.signal }, async scoped => { const response = await scoped.request("/api/v1/file", { signal: new AbortController().signal }); controller.abort(new Error("custom cancellation")); return response.text(); });
  await expect(result).rejects.toMatchObject({ name: "AbortError" });
  expect(bodyCancel).toHaveBeenCalledTimes(1); expect(getEventListeners(controller.signal, "abort")).toHaveLength(0); expect(vi.getTimerCount()).toBe(0);
});
it("#114 rejects cursor loops and escaped entry paths, and surfaces expired history", async () => {
  const malformed = (result: unknown) => client(async url => String(url).includes("whoami") ? who() : Response.json(result));
  await expect(collect(changeBatches(malformed({ checkpoint: 2, nextCursor: 1, changes: [] }), "/", { since: 0 }))).rejects.toThrow("cursor");
  await expect(collect(changeBatches(malformed({ checkpoint: 2, nextCursor: null, changes: [{ seq: 1, path: "/safe/a", operation: "upsert", entry: entry("/outside") }] }), "/safe", { since: 0 }))).rejects.toThrow("change entry");
  const expired = client(async url => String(url).includes("whoami") ? who() : Response.json({ error: "expired" }, { status: 410 }));
  await expect(collect(changeBatches(expired, "/", { since: 0 }))).rejects.toMatchObject({ status: 410 });
});
it("verifySource can refuse completing resumes and zero-byte commits before mutation", async () => {
  const request = vi.fn(async (url: any) => String(url).endsWith("/resumable") ? Response.json({ uploadId: "upl_resume", partSize: 8388608, status: "completing", parts: [{ partNumber: 1, digest: createHash("sha256").update(new Uint8Array([1])).digest("hex") }] }) : Response.json({ entry: entry("/file") }));
  const c = client(request); const verifySource = vi.fn(async () => { throw new Error("source changed"); });
  await expect(c.upload("/file", new Uint8Array([1]), { verifySource })).rejects.toThrow("source changed"); expect(request).toHaveBeenCalledTimes(1); expect(verifySource).toHaveBeenCalledTimes(1);
  const empty = vi.fn(async (url: any) => String(url).endsWith("/upload-intents") ? Response.json({ uploadId: "upl_empty", url: "https://agfs.dev/api/v1/fs/uploads/upl_empty/blob", headers: {} }) : new Response(null));
  await expect(client(empty).upload("/file", new Uint8Array(), { verifySource })).rejects.toThrow("source changed"); expect(empty).toHaveBeenCalledTimes(2);
});
it("#117 verifies exact body bytes, either rotated signature, and bounded replay/header inputs", async () => {
  const body = new TextEncoder().encode('{"event":"é"}'), signature = createHmac("sha256", "secret").update("100.").update(body).digest("hex");
  const headers = { timestamp: "100", signature: "v1=" + "0".repeat(64) + ",v1=" + signature };
  expect(await verifyWebhook("secret", body, headers, { nowSeconds: 100 })).toBe(true);
  expect(await verifyWebhook("secret", new TextEncoder().encode("different"), headers, { nowSeconds: 100 })).toBe(false);
  expect(await verifyWebhook("secret", body, headers, { nowSeconds: 401 })).toBe(false);
  expect(await verifyWebhook("secret", body, { ...headers, signature: "x".repeat(161) }, { nowSeconds: 100 })).toBe(false);
});
it("#118 validates the entire batch before requests and returns recovery information on partial failure", async () => {
  const c = client(vi.fn()); const create = vi.spyOn(c, "createDraft").mockResolvedValue({ id: "draft_1" });
  const change = vi.spyOn(c, "changeDraft").mockResolvedValueOnce({}).mockRejectedValueOnce(new AgfsError(409, "conflict"));
  await expect(stageDraft(c, { name: "review", path: "/safe", changes: [{ path: "/safe/a", operation: "write", content: "" }, { path: "/outside", operation: "delete" }] })).rejects.toThrow("draft change"); expect(create).not.toHaveBeenCalled();
  await expect(stageDraft(c, { name: "review", path: "/safe", changes: [{ path: "/safe/a", operation: "write", content: "" }, { path: "/safe/b", operation: "delete" }] })).rejects.toMatchObject({ resourceId: "draft_1", completed: 1 }); expect(change).toHaveBeenCalledTimes(2);
});
it("#119 completes a managed run only after a successful callback and retains the original failure", async () => {
  const c = client(vi.fn()); vi.spyOn(c, "startRun").mockResolvedValue({ id: "run_1", status: "running" }); const complete = vi.spyOn(c, "completeRun").mockResolvedValue({});
  const cause = new Error("task failed"); await expect(withRun(c, "job", "/", async () => { throw cause; })).rejects.toMatchObject({ resourceId: "run_1", cause }); expect(complete).not.toHaveBeenCalled();
  expect(await withRun(c, "job", "/", async run => run.id + ":ok")).toEqual({ id: "run_1", value: "run_1:ok" }); expect(complete).toHaveBeenCalledTimes(1);
});
