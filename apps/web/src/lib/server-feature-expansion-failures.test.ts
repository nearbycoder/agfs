import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { serverFixture } from "./server-expansion-fixture.test-utils";

const state = vi.hoisted(() => ({ fixture: null as any, get: vi.fn(), delete: vi.fn(async () => {}) }));
vi.mock("./bindings", () => ({
  requireResourceBindings: () => ({ DB: { prepare: (q: string) => state.fixture.binding.prepare(q), batch: (q: any[]) => state.fixture.binding.batch(q) }, FILES_BUCKET: { get: state.get, delete: state.delete } }),
  requireStringBindings: () => ({ APP_URL: "https://agfs.dev", BETTER_AUTH_SECRET: "synthetic-failure-lifecycle-key" }), getBindings: () => ({}),
}));
import { queueFailures, retryFailures } from "./resource-controls";
import { cleanupWebhookHistory } from "./resource-controls-retention";
import { consumeBackground } from "./background";
import { cleanupExpired } from "./cleanup";
import { indexFiles } from "./search";
import { retryWebhook } from "./webhooks";

const auth = { authSource: "session", user: { id: "alice", name: "Alice", email: "alice@example.test" } } as const;
const bob = { ...auth, user: { id: "bob", name: "Bob", email: "bob@example.test" } } as const;
let f: ReturnType<typeof serverFixture>;
beforeEach(() => { f = serverFixture(); state.fixture = f; state.get.mockReset(); state.delete.mockClear(); });
afterEach(() => { f.sqlite.close(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
function hook(id = "hook", owner = "alice", path = "/") {
  f.sqlite.prepare("INSERT INTO webhooks(id,owner_id,url,path_prefix,events,secret,created_at) VALUES(?,?,'https://example.com/hook',?,'[]','synthetic-webhook-key',1)").run(id, owner, path);
}
function delivery(id: string, status = "pending", attempts = 7, created = Date.now(), hookId = "hook") {
  f.sqlite.prepare("INSERT INTO webhook_deliveries(id,webhook_id,event_id,payload,attempts,status,next_attempt,created_at) VALUES(?,?,?,'{}',?,?,0,?)").run(id, hookId, id, attempts, status, created);
}
async function consume(id: string, kind = "webhook", dead = false, generation?: number) {
  const ack = vi.fn(), retry = vi.fn();
  await consumeBackground({ queue: dead ? "background-dead" : "background", messages: [{ body: { id, kind, ...(generation === undefined ? {} : { generation }) }, ack, retry }] } as any);
  return { ack, retry };
}
function generation(id: string, kind = "webhook") { return f.sqlite.prepare("SELECT generation FROM resource_work WHERE kind=? AND id=?").get(kind, id)!.generation as number; }

describe("R2 failure inbox source lifecycle", () => {
  it("projects an ordinary attempt-eight HTTP failure and permits selected retry", async () => {
    hook(); delivery("d"); vi.stubGlobal("fetch", vi.fn(async () => new Response("failure", { status: 500 })));
    const message = await consume("d", "webhook", false, generation("d"));
    expect(f.sqlite.prepare("SELECT status,attempts,last_error FROM webhook_deliveries WHERE id='d'").get()).toMatchObject({ status: "failed", attempts: 8, last_error: "Endpoint returned HTTP 500" });
    expect(message.ack).toHaveBeenCalledOnce(); expect(message.retry).not.toHaveBeenCalled();
    expect((await queueFailures(auth)).results).toMatchObject([{ id: "d", kind: "webhook", path: "/", lastError: "Endpoint returned HTTP 500" }]);
    expect((await retryFailures(auth, ["d"])).results).toEqual([{ id: "d", status: "retried" }]);
    expect((await queueFailures(auth)).results).toEqual([]);
    expect(f.sqlite.prepare("SELECT status,attempts FROM webhook_deliveries WHERE id='d'").get()).toMatchObject({ status: "pending", attempts: 0 });
  });
  it("removes projection metadata on selected cleanup, actual hourly expiry, and indexed-entry deletion", async () => {
    hook(); delivery("selected", "failed", 8); delivery("hourly", "failed", 8, 1); f.entry("index-failure");
    f.sqlite.exec("UPDATE index_job_status SET attempts=1,last_error='current index error'; INSERT INTO queue_failures VALUES('selected','webhook',1,'exhausted'),('hourly','webhook',1,'exhausted'),('index-failure','index',1,'exhausted')");
    expect((await queueFailures(auth)).results).toHaveLength(3);
    f.sqlite.exec("DELETE FROM entries WHERE id='index-failure'");
    expect((await cleanupWebhookHistory(auth, ["selected"], false)).deleted).toEqual(["selected"]);
    await cleanupExpired(); expect(f.sqlite.prepare("SELECT id FROM webhook_deliveries").all()).toEqual([]);
    expect((await queueFailures(auth)).results).toEqual([]);
    expect((await retryFailures(auth, ["selected", "hourly", "index-failure"])).results.every((r) => r.status === "unavailable")).toBe(true);
    expect(f.sqlite.prepare("SELECT * FROM resource_failures").all()).toEqual([]);
  });
  it("backfills current failed sources without a dead letter and excludes stale/healthy diagnostics", async () => {
    f.sqlite.close(); f = serverFixture("0017~"); state.fixture = f;
    hook(); hook("other", "bob", "/bob"); delivery("ordinary", "failed", 8); delivery("foreign", "failed", 8, 1, "other"); delivery("delivered", "delivered", 1); delivery("pending");
    f.entry("failed-index"); f.entry("healthy-index");
    f.sqlite.exec("UPDATE index_job_status SET attempts=2,last_error='current index error' WHERE entry_id='failed-index'; UPDATE webhook_deliveries SET last_error='current delivery error' WHERE id='ordinary'; INSERT INTO queue_failures VALUES('ordinary','webhook',1,'old secret'),('delivered','webhook',1,'old secret'),('pending','webhook',1,'old secret'),('healthy-index','index',1,'old secret'),('gone','index',1,'old secret')");
    f.sqlite.exec(readFileSync(new URL("../../../../packages/db/src/migrations/0018_resource_controls.sql", import.meta.url), "utf8"));
    expect((await queueFailures(auth)).results.map((r) => r.id).sort()).toEqual(["failed-index", "ordinary"]);
    expect((await queueFailures(bob)).results.map((r) => r.id)).toEqual(["foreign"]);
    expect(JSON.stringify(await queueFailures(auth))).not.toContain("old secret");
    expect((await retryFailures(auth, ["ordinary", "failed-index"])).results.every((r) => r.status === "retried")).toBe(true);
    expect((await queueFailures(auth)).results).toEqual([]);
  });
  it("keeps repeated ordinary failure/retry cycles actionable with only one projection row, then removes it on success", async () => {
    hook(); delivery("d"); const send = vi.fn(async () => new Response("failure", { status: 500 })); vi.stubGlobal("fetch", send);
    for (let cycle = 0; cycle < 3; cycle++) {
      f.sqlite.exec("UPDATE webhook_deliveries SET attempts=7,next_attempt=0 WHERE id='d'");
      await consume("d", "webhook", false, generation("d"));
      expect((await queueFailures(auth)).results.map((r) => r.id)).toEqual(["d"]);
      expect(f.sqlite.prepare("SELECT count(*) AS n FROM resource_failures").get()!.n).toBe(1);
      expect((await retryFailures(auth, ["d"])).results[0].status).toBe("retried");
      expect((await queueFailures(auth)).results).toEqual([]);
    }
    send.mockImplementation(async () => new Response(null, { status: 204 })); await consume("d", "webhook", false, generation("d"));
    expect(f.sqlite.prepare("SELECT status FROM webhook_deliveries WHERE id='d'").get()!.status).toBe("delivered");
    expect((await queueFailures(auth)).results).toEqual([]); expect(f.sqlite.prepare("SELECT * FROM resource_work WHERE id='d'").all()).toEqual([]);
  });
  it("retains disabled failures, rejects foreign or concurrently moved retries, and removes successful legacy retries", async () => {
    hook(); delivery("d", "failed", 8); f.sqlite.exec("UPDATE webhooks SET enabled=0; INSERT INTO queue_failures VALUES('d','webhook',1,'old diagnostic')");
    expect((await retryFailures(auth, ["d"])).results[0].status).toBe("unavailable");
    expect((await queueFailures(auth)).results.map((r) => r.id)).toEqual(["d"]);
    expect((await retryFailures(bob, ["d"])).results[0].status).toBe("unavailable");
    f.sqlite.exec("UPDATE webhooks SET enabled=1");
    f.beforeBatch = () => { f.beforeBatch = () => {}; f.sqlite.exec("UPDATE webhooks SET owner_id='bob',path_prefix='/new' WHERE id='hook'"); };
    expect((await retryFailures(auth, ["d"])).results[0].status).toBe("unavailable");
    expect((await queueFailures(auth)).results).toEqual([]); expect((await queueFailures(bob)).results).toMatchObject([{ id: "d", path: "/new" }]);
    await retryWebhook(bob, "d"); expect((await queueFailures(bob)).results).toEqual([]);
    // A later legacy diagnostic update cannot resurrect the successfully reset source.
    f.sqlite.exec("UPDATE queue_failures SET last_error='late old diagnostic',created_at=2 WHERE id='d'"); expect((await queueFailures(bob)).results).toEqual([]);
  });
  it.each(["entries", "index_jobs", "webhooks", "webhook_deliveries"])("removes failed metadata through direct deletion and cascades from %s", async (table) => {
    hook(); delivery("d", "failed", 8); f.entry("file"); f.sqlite.exec("UPDATE index_job_status SET attempts=1,last_error='failed'");
    expect(f.sqlite.prepare("SELECT count(*) AS n FROM resource_failures").get()!.n).toBe(2);
    f.sqlite.exec(`DELETE FROM ${table}`);
    const remaining = (await queueFailures(auth)).results.map((r) => r.id);
    expect(remaining).toEqual(table.startsWith("webhook") ? ["file"] : ["d"]);
  });
  it("projects ordinary index errors and removes them on actual successful completion or legacy reset", async () => {
    f.entry("file"); state.get.mockRejectedValueOnce(new Error("synthetic object outage"));
    await expect(indexFiles(1, "file")).rejects.toThrow("synthetic object outage");
    expect((await queueFailures(auth)).results).toMatchObject([{ id: "file", kind: "index", lastError: "Object could not be indexed" }]);
    state.get.mockResolvedValue({ size: 10, text: async () => "hello" });
    f.sqlite.exec("UPDATE index_job_status SET next_attempt=0 WHERE entry_id='file'");
    await indexFiles(1, "file"); expect((await queueFailures(auth)).results).toEqual([]);
    f.sqlite.exec("INSERT INTO index_jobs VALUES('file'); UPDATE index_job_status SET attempts=1,last_error='legacy failure'");
    expect((await queueFailures(auth)).results).toHaveLength(1);
    f.sqlite.exec("UPDATE index_job_status SET attempts=0,last_error=NULL"); expect((await queueFailures(auth)).results).toEqual([]);
  });
  it("uses live owner/path/error through transfers, renames, and legacy diagnostic inserts/updates/deletes", async () => {
    hook(); delivery("d", "failed", 8); f.entry("file");
    f.sqlite.exec("UPDATE index_job_status SET attempts=1,last_error='current index'; UPDATE webhook_deliveries SET last_error='current hook' WHERE id='d'; INSERT INTO queue_failures VALUES('file','index',1,'old owner error'),('d','webhook',1,'old owner error')");
    f.sqlite.exec("UPDATE entries SET owner_id='bob',path='/new/file' WHERE id='file'; UPDATE webhooks SET owner_id='bob',path_prefix='/new/hook'");
    expect((await queueFailures(auth)).results).toEqual([]);
    // The baseline entry-update trigger resets indexing attempts on any edit,
    // including ownership/path moves. Its old failure must disappear, not move.
    expect(f.sqlite.prepare("SELECT attempts FROM index_job_status WHERE entry_id='file'").get()!.attempts).toBe(0);
    expect((await queueFailures(bob)).results.map((r) => [r.id, r.path, r.lastError])).toEqual([["d", "/new/hook", "current hook"]]);
    f.sqlite.exec("UPDATE entries SET path='/renamed/file' WHERE id='file'; UPDATE webhooks SET path_prefix='/renamed/hook'; UPDATE queue_failures SET last_error='late private old error'; DELETE FROM queue_failures");
    f.sqlite.exec("UPDATE index_job_status SET attempts=1,last_error='new owner index' WHERE entry_id='file'");
    expect((await queueFailures(bob)).results.map((r) => [r.id, r.path, r.lastError]).sort()).toEqual([["d", "/renamed/hook", "current hook"], ["file", "/renamed/file", "new owner index"]]);
    expect((await retryFailures(auth, ["d", "file"])).results.every((r) => r.status === "unavailable")).toBe(true);
    expect((await retryFailures(bob, ["d", "file"])).results.every((r) => r.status === "retried")).toBe(true);
  });
  it.each(["index", "webhook"])("never resurrects a deleted or recreated source from stale/legacy %s dead letters", async (kind) => {
    hook(); if (kind === "index") f.entry("source"); else delivery("source");
    const old = generation("source", kind);
    f.sqlite.exec(kind === "index" ? "DELETE FROM entries WHERE id='source'" : "DELETE FROM webhook_deliveries WHERE id='source'");
    await consume("source", kind, true, old); await consume("source", kind, true);
    expect((await queueFailures(auth)).results).toEqual([]);
    if (kind === "index") f.entry("source", "/new-owner", "bob"); else { hook("bob-hook", "bob", "/new-owner"); delivery("source", "pending", 0, Date.now(), "bob-hook"); }
    const fresh = generation("source", kind); expect(fresh).toBeGreaterThan(old);
    await consume("source", kind, true, old); await consume("source", kind, true);
    expect((await queueFailures(auth)).results).toEqual([]); expect((await queueFailures(bob)).results).toEqual([]);
    expect(generation("source", kind)).toBe(fresh);
    if (kind === "index") f.sqlite.exec("UPDATE index_job_status SET attempts=1,last_error='new owner failure' WHERE entry_id='source'");
    else f.sqlite.exec("UPDATE webhook_deliveries SET status='failed',last_error='new owner failure' WHERE id='source'");
    await consume("source", kind, true); f.sqlite.exec("UPDATE queue_failures SET last_error='stale previous owner error'");
    expect((await queueFailures(bob)).results).toMatchObject([{ id: "source", path: "/new-owner", lastError: "new owner failure" }]);
    expect((await queueFailures(auth)).results).toEqual([]);
  });
  it.each(["index", "webhook"])("projects a current-generation %s dead letter from its atomic source transition", async (kind) => {
    hook(); if (kind === "index") f.entry("source"); else delivery("source");
    await consume("source", kind, true, generation("source", kind));
    expect((await queueFailures(auth)).results).toMatchObject([{ id: "source", kind }]);
    expect((await retryFailures(auth, ["source"])).results[0].status).toBe("retried");
    expect((await queueFailures(auth)).results).toEqual([]); expect(f.sqlite.prepare("SELECT * FROM queue_failures WHERE id='source'").all()).toEqual([]);
  });
  it("checks manage authorization before failure metadata reads or retry writes", async () => {
    hook(); delivery("d", "failed", 8); f.reset();
    const denied = { ...auth, permissions: ["read"] as Array<"read"> };
    await expect(queueFailures(denied)).rejects.toMatchObject({ status: 403 });
    await expect(retryFailures(denied, ["d"])).rejects.toMatchObject({ status: 403 }); expect(f.calls).toEqual([]);
  });
});
