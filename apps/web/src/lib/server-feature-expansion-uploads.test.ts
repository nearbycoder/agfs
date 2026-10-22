import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hashSecret } from "@agfs/db";
import { serverFixture, deferred } from "./server-expansion-fixture.test-utils";
const state = vi.hoisted(() => ({ fixture: null as any, put: vi.fn(), remove: vi.fn(), head: vi.fn(), abort: vi.fn(), complete: vi.fn(), commit: vi.fn() }));
vi.mock("./bindings", () => ({
  requireResourceBindings: () => ({ DB: { prepare: (q: string) => state.fixture.binding.prepare(q), batch: (q: unknown[]) => state.fixture.binding.batch(q) },
    FILES_BUCKET: { put: state.put, delete: state.remove, head: state.head, resumeMultipartUpload: () => ({ abort: state.abort, complete: state.complete }) } }),
  requireStringBindings: () => ({ APP_URL: "https://agfs.dev" }), getBindings: () => ({}),
}));
vi.mock("@tanstack/react-router", () => ({ createFileRoute: () => (options: unknown) => options }));
vi.mock("./fs", () => ({ commitUpload: state.commit, createUploadIntent: vi.fn() }));
import { Route } from "../routes/api/v1/fs/uploads/$id/blob";
import { abandonUploads } from "./resource-controls-uploads";
import { collectGarbage, queueObject } from "./garbage";
import { atomicBatch } from "./atomic-batch";
import { cleanupExpired } from "./cleanup";
import { completeMultipart } from "./uploads";
const auth = { authSource: "session", user: { id: "alice", email: "alice@example.test", name: "Alice" } } as const;
const uploadToken = "test-upload-token-not-a-real-secret";
let fixture: ReturnType<typeof serverFixture>, at: number, objects: Map<string, string>;
beforeEach(() => {
  fixture = serverFixture(); state.fixture = fixture; at = Date.now() + 1000; objects = new Map();
  vi.spyOn(Date, "now").mockImplementation(() => at);
  state.put.mockReset().mockImplementation(async (key, body, options) => {
    expect(options.onlyIf).toEqual({ etagDoesNotMatch: "*" });
    if (objects.has(key)) return null;
    objects.set(key, await new Response(body).text()); return { etag: "etag", size: 4 };
  });
  state.remove.mockReset().mockImplementation(async (keys) => { for (const key of typeof keys === "string" ? [keys] : keys) objects.delete(key); });
  state.head.mockReset().mockImplementation(async (key) => objects.has(key) ? { etag: "etag", size: 4 } : null);
  state.abort.mockReset().mockResolvedValue(undefined);
  state.complete.mockReset().mockImplementation(async () => { objects.set("key", "body"); return { etag: "etag", size: 4 }; });
  state.commit.mockReset().mockImplementation(async (_auth, id) => {
    const row = fixture.sqlite.prepare("SELECT * FROM uploads WHERE id=? AND status IN ('pending','completing')").get(id);
    if (!row) throw new Error("Upload no longer active");
    fixture.entry("live", "/file", "alice", "file", "key");
    fixture.sqlite.prepare("UPDATE uploads SET status='committed' WHERE id=?").run(id);
    return { path: "/file" };
  });
});
afterEach(() => { fixture.sqlite.close(); vi.restoreAllMocks(); });
function upload(multipart = false) {
  fixture.sqlite.prepare("INSERT INTO uploads(id,owner_id,path,content_type,size,object_key,upload_token_hash,status,expires_at,multipart_id) VALUES('upload','alice','/file','text/plain',4,'key',?,'pending',?,?)")
    .run(hashSecret(uploadToken), at + 10000, multipart ? "multipart" : null);
  if (multipart) fixture.sqlite.exec("INSERT INTO upload_parts VALUES('upload',1,'digest','etag',4)");
}
function put() { return (Route as any).server.handlers.PUT({ params: { id: "upload" }, request: new Request("https://agfs.dev/api/v1/fs/uploads/upload/blob", {
  method: "PUT", headers: { "x-agfs-upload-token": uploadToken, "content-length": "4" }, body: "body",
}) }) as Promise<Response>; }

describe("direct upload abandonment and physical cleanup", () => {
  it.each([false, true])("requeues a late object after GC, reservation removed=%s", async (removeReservation) => {
    upload(); const started = deferred(), finish = deferred();
    state.put.mockImplementationOnce(async () => { started.resolve(); await finish.promise; objects.set("key", "body"); return { etag: "etag" }; });
    const response = put(); await started.promise;
    await abandonUploads(auth, ["upload"], false);
    if (removeReservation) { at += 10001; await cleanupExpired(); }
    else { fixture.sqlite.exec("INSERT INTO object_gc VALUES('key',1)"); await collectGarbage(); }
    expect(objects.has("key")).toBe(false);
    expect(fixture.sqlite.prepare("SELECT 1 FROM object_gc").get()).toBeUndefined();
    finish.resolve(); expect((await response).status).toBe(409);
    expect(objects.get("key")).toBe("body");
    expect(fixture.sqlite.prepare("SELECT 1 FROM object_gc WHERE r2_key='key'").get()).toBeDefined();
    await collectGarbage(); expect(objects.has("key")).toBe(false);
  });
  it("preserves a successful commit while an earlier PUT finalizer settles", async () => {
    upload(); const started = deferred(), finish = deferred();
    state.put.mockImplementationOnce(async () => { objects.set("key", "body"); started.resolve(); await finish.promise; return { etag: "etag" }; });
    const response = put(); await started.promise; await state.commit(auth.user, "upload");
    expect((await abandonUploads(auth, ["upload"], false)).results[0].status).toBe("not-pending");
    fixture.sqlite.exec("INSERT INTO object_gc VALUES('key',1)"); await collectGarbage();
    finish.resolve(); expect((await response).status).toBe(200); await collectGarbage();
    expect(objects.get("key")).toBe("body");
  });
  it("retains a newer cleanup intent while an earlier R2 deletion response is in flight", async () => {
    upload(); const started = deferred(), finish = deferred(), deleted = deferred(), acknowledgeDelete = deferred();
    state.put.mockImplementationOnce(async () => { started.resolve(); await finish.promise; objects.set("key", "body"); return { etag: "etag" }; });
    const response = put(); await started.promise;
    await abandonUploads(auth, ["upload"], false);
    fixture.sqlite.exec("INSERT INTO object_gc VALUES('key',1)");
    state.remove.mockImplementationOnce(async () => { objects.delete("key"); deleted.resolve(); await acknowledgeDelete.promise; });
    const gc = collectGarbage(); await deleted.promise;
    finish.resolve(); expect((await response).status).toBe(409);
    acknowledgeDelete.resolve(); await gc;
    expect(objects.get("key")).toBe("body");
    expect(fixture.sqlite.prepare("SELECT 1 FROM object_gc WHERE r2_key='key'").get()).toBeDefined();
    await collectGarbage(); expect(objects.has("key")).toBe(false);
  });
  it("handles duplicate PUTs and retries after a lost response with create-only bytes", async () => {
    upload(); expect((await put()).status).toBe(200); expect((await put()).status).toBe(409);
    expect(objects.get("key")).toBe("body");
    await abandonUploads(auth, ["upload"], false); expect((await put()).status).toBe(404);
    at += 10001; await cleanupExpired(); expect(objects.has("key")).toBe(false);
  });
  it("requeues partial writes even when R2 rejects after abandonment and reservation removal", async () => {
    upload();
    state.put.mockImplementationOnce(async () => {
      await abandonUploads(auth, ["upload"], false); at += 10001; await cleanupExpired();
      objects.set("key", "partial"); throw new Error("R2 interrupted");
    });
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await put()).status).toBe(500); await collectGarbage(); expect(objects.has("key")).toBe(false); expect(log).toHaveBeenCalled();
  });
  it("survives baseline GC acknowledgement after a new finalizer renews a missing reservation", async () => {
    upload(); const started = deferred(), finish = deferred();
    state.put.mockImplementationOnce(async () => { started.resolve(); await finish.promise; objects.set("key", "body"); return { etag: "etag" }; });
    const response = put(); await started.promise;
    await abandonUploads(auth, ["upload"], false);
    fixture.sqlite.exec("INSERT INTO object_gc VALUES('key',1)");
    // Exact baseline9663bb0 candidate SQL and the two final DELETE statements,
    // with the template bind compiled to ?. Its R2 delete takes effect first.
    const legacy = fixture.sqlite.prepare(`SELECT r2_key FROM object_gc AS gc
      WHERE NOT EXISTS (SELECT 1 FROM entries WHERE r2_key=gc.r2_key)
        AND NOT EXISTS (SELECT 1 FROM recovery WHERE r2_key=gc.r2_key)
        AND NOT EXISTS (SELECT 1 FROM object_pins WHERE object_key=gc.r2_key AND expires_at>unixepoch()*1000)
        AND NOT EXISTS (SELECT 1 FROM uploads WHERE object_key=gc.r2_key AND status IN ('pending','completing'))
      ORDER BY created_at LIMIT 100`).all();
    expect(legacy).toEqual([{ r2_key: "key" }]); objects.delete("key");
    fixture.sqlite.exec("DELETE FROM uploads WHERE id='upload'");
    finish.resolve(); expect((await response).status).toBe(409);
    const encoded = JSON.stringify(legacy.map((r) => r.r2_key));
    fixture.sqlite.prepare("DELETE FROM object_usage WHERE object_key IN (SELECT value FROM json_each(?))").run(encoded);
    fixture.sqlite.prepare("DELETE FROM object_gc WHERE r2_key IN (SELECT value FROM json_each(?))").run(encoded);
    expect(fixture.sqlite.prepare("SELECT 1 FROM object_gc").get()).toBeUndefined();
    expect(fixture.sqlite.prepare("SELECT 1 FROM resource_object_gc").get()).toBeDefined();
    await collectGarbage(); expect(objects.has("key")).toBe(false);
    expect(fixture.sqlite.prepare("SELECT 1 FROM resource_object_gc").get()).toBeUndefined();
  });
  it("renews duplicate and delete/recreate intents without ABA and retries partial R2 batches", async () => {
    objects.set("a", "a"); objects.set("b", "b");
    await atomicBatch([queueObject("a"), queueObject("b")]);
    const old = fixture.sqlite.prepare("SELECT generation FROM resource_object_gc WHERE r2_key='a'").get()!.generation;
    await atomicBatch([queueObject("a")]);
    expect(fixture.sqlite.prepare("SELECT generation FROM resource_object_gc WHERE r2_key='a'").get()!.generation).toBeGreaterThan(old as number);
    fixture.sqlite.exec("DELETE FROM object_gc WHERE r2_key='a'"); await atomicBatch([queueObject("a")]);
    state.remove.mockImplementationOnce(async () => { objects.delete("a"); throw new Error("partial batch failure"); });
    vi.spyOn(console, "error").mockImplementation(() => {});
    await collectGarbage(); expect(fixture.sqlite.prepare("SELECT count(*) AS n FROM resource_object_gc").get()!.n).toBe(2);
    await collectGarbage(); expect(objects.size).toBe(0);
    expect(fixture.sqlite.prepare("SELECT count(*) AS n FROM resource_object_gc").get()!.n).toBe(0);
  });
  it("rechecks an appearing live reference before deleting bytes", async () => {
    objects.set("key", "body"); await atomicBatch([queueObject("key")]);
    fixture.beforeStatement = (q) => {
      if (q.startsWith("SELECT r2_key,generation FROM resource_object_gc AS gc")) {
        fixture.beforeStatement = () => {}; fixture.entry("live", "/file", "alice", "file", "key");
      }
    };
    await collectGarbage(); expect(state.remove).not.toHaveBeenCalled(); expect(objects.get("key")).toBe("body");
    fixture.sqlite.exec("DELETE FROM entries WHERE id='live'");
    await collectGarbage(); expect(objects.size).toBe(0);
  });
  it("bounds candidate reads and advances past referenced objects without dropping intents", async () => {
    for (let i = 0; i < 101; i++) {
      const key = `a${String(i).padStart(3, "0")}`; fixture.entry(key); objects.set(key, key);
      fixture.sqlite.prepare("INSERT INTO object_gc VALUES(?,1)").run(key);
    }
    objects.set("z", "orphan"); fixture.sqlite.exec("INSERT INTO object_gc VALUES('z',1)");
    await collectGarbage(); expect(state.remove).not.toHaveBeenCalled();
    await collectGarbage(); expect(state.remove).toHaveBeenCalledWith(["z"]); expect(objects.size).toBe(101);
    expect(fixture.sqlite.prepare("SELECT count(*) AS n FROM resource_object_gc").get()!.n).toBe(101);
  });
  it("records full collector SQL, trigger writes, R2 operations and idle cost", async () => {
    fixture.reset(); const before = Number(fixture.sqlite.prepare("SELECT total_changes() AS n").get()!.n);
    await collectGarbage();
    const idle = { roundTrips: fixture.trips, statements: fixture.calls.length, changedRows: Number(fixture.sqlite.prepare("SELECT total_changes() AS n").get()!.n) - before, r2DeleteCalls: state.remove.mock.calls.length };
    expect(idle).toEqual({ roundTrips: 2, statements: 2, changedRows: 0, r2DeleteCalls: 0 });
    for (let i = 0; i < 150; i++) {
      const key = `object${i}`; objects.set(key, "body");
      fixture.sqlite.prepare("INSERT INTO object_gc VALUES(?,1)").run(key);
      fixture.sqlite.prepare("INSERT INTO object_usage VALUES(?,'alice',NULL,4)").run(key);
    }
    fixture.reset(); const changes = Number(fixture.sqlite.prepare("SELECT total_changes() AS n").get()!.n);
    const cpu = process.cpuUsage(); await collectGarbage(); const used = process.cpuUsage(cpu);
    const active = { roundTrips: fixture.trips, statements: fixture.calls.length, changedRows: Number(fixture.sqlite.prepare("SELECT total_changes() AS n").get()!.n) - changes,
      r2DeleteCalls: state.remove.mock.calls.length, r2KeysSubmitted: state.remove.mock.calls[0][0].length, processCpuMicroseconds: used.user + used.system,
      plans: fixture.calls.filter((r) => r.query.startsWith("SELECT")).map((r) => fixture.plan(r.query, r.params)) };
    expect(active).toMatchObject({ roundTrips: 5, statements: 7, changedRows: 301, r2DeleteCalls: 1, r2KeysSubmitted: 100 });
    writeFileSync(join(tmpdir(), "agfs-server-feature-gc-20261022.json"), JSON.stringify({ measurement: "Real collector, local SQLite and synthetic R2. R2 calls/keys count request operations, not billed classes or bytes. total_changes includes triggers, not billed D1 rows_written; query plans are not rows_read. Local process CPU includes test/SQLite overhead.", idle, active }, null, 2) + "\n");
  });
});

describe("multipart completion claims", () => {
  it("refuses a completion when abandonment wins before the claim", async () => {
    upload(true);
    fixture.beforeStatement = (q) => {
      if (/^update "uploads" set "status"/.test(q)) { fixture.beforeStatement = () => {}; fixture.sqlite.exec("UPDATE uploads SET status='expired' WHERE id='upload'"); }
    };
    await expect(completeMultipart(auth, "upload")).rejects.toMatchObject({ status: 409 });
    expect(state.complete).not.toHaveBeenCalled(); expect(state.commit).not.toHaveBeenCalled();
    at += 10001; await cleanupExpired(); expect(state.abort).toHaveBeenCalledOnce();
  });
  it("prevents abandonment after claim and permits retry of a lost completion result", async () => {
    upload(true); const started = deferred(), finish = deferred();
    state.complete.mockImplementationOnce(async () => { started.resolve(); await finish.promise; objects.set("key", "body"); return { etag: "etag" }; });
    const completion = completeMultipart(auth, "upload"); await started.promise;
    expect((await abandonUploads(auth, ["upload"], false)).results[0].status).toBe("not-pending");
    finish.resolve(); await completion;
    expect(await completeMultipart(auth, "upload")).toEqual({ ok: true });
    expect(state.complete).toHaveBeenCalledOnce(); expect(objects.get("key")).toBe("body");
  });
  it("requeues an object completing after expiry cleanup removed its reservation", async () => {
    upload(true); const started = deferred(), finish = deferred();
    state.complete.mockImplementationOnce(async () => { started.resolve(); await finish.promise; objects.set("key", "body"); return { etag: "etag" }; });
    const completion = completeMultipart(auth, "upload"); await started.promise;
    at += 10001; await cleanupExpired(); finish.resolve();
    await expect(completion).rejects.toThrow("Upload no longer active");
    await collectGarbage(); expect(objects.has("key")).toBe(false);
  });
});
