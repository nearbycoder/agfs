import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { serverFixture } from "./server-expansion-fixture.test-utils";
import { operationMetricsSchema } from "@agfs/contracts";
const state = vi.hoisted(() => ({ fixture: null as any, get: vi.fn(), sendBatch: vi.fn() }));
vi.mock("./bindings", () => ({
  requireResourceBindings: () => ({ DB: { prepare: (q: string) => state.fixture.binding.prepare(q), batch: (q: unknown[]) => state.fixture.binding.batch(q) }, FILES_BUCKET: { get: state.get } }),
  requireStringBindings: () => ({ APP_URL: "https://agfs.dev", BETTER_AUTH_SECRET: "synthetic-local-review-signing-key" }),
  getBindings: () => ({ BACKGROUND_QUEUE: { sendBatch: state.sendBatch } }),
}));
import { resourceControlsApi } from "./resource-controls-api";
import { indexFiles, searchFiles } from "./search";
import { health } from "./operations";
import { reconcileDirectUpload } from "./resource-controls-uploads";
import type { RequestAuth } from "./authz";

const auth: RequestAuth = { authSource: "session", user: { id: "alice", email: "alice@example.test", name: "Alice" } };
let fixture: ReturnType<typeof serverFixture>, at: number;
beforeEach(() => {
  fixture = serverFixture(); state.fixture = fixture; at = Date.now();
  vi.spyOn(Date, "now").mockImplementation(() => at);
  state.get.mockReset().mockResolvedValue({ size: 10, text: async () => "hello text" });
  state.sendBatch.mockReset().mockResolvedValue(undefined);
});
afterEach(() => { fixture.sqlite.close(); vi.restoreAllMocks(); });
async function api(path: string, method = "GET", body?: unknown, access = auth): Promise<any> {
  const request = new Request("https://agfs.dev/api/v1/platform/operations" + path, { method,
    ...(body === undefined ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }) });
  return (await resourceControlsApi(request, access, "/operations" + path.split("?")[0]))?.json();
}
function token(id = "token", owner = "alice") {
  fixture.sqlite.prepare("INSERT INTO api_tokens(id,owner_id,label,prefix,token_hash) VALUES(?,?,?,'test',?)").run(id, owner, id, id);
}
function upload(id: string, status = "pending", owner = "alice", multipart = false) {
  fixture.sqlite.prepare("INSERT INTO uploads(id,owner_id,path,content_type,size,object_key,status,expires_at,created_at,token_id,multipart_id) VALUES(?,?,'/folder/file','text/plain',100,?,?,?,1,'token',?)")
    .run(id, owner, id + "-key", status, at + 100000, multipart ? id + "-multipart" : null);
}
function hook(id = "hook", owner = "alice") {
  fixture.sqlite.prepare("INSERT INTO webhooks(id,owner_id,url,path_prefix,events,secret,created_at) VALUES(?,?,'https://hooks.example.com','/','[\"*\"]','never-return',1)").run(id, owner);
}
function delivery(id: string, status = "pending", webhook = "hook") {
  fixture.sqlite.prepare("INSERT INTO webhook_deliveries(id,webhook_id,event_id,payload,status,next_attempt,created_at) VALUES(?,?,?,'secret-payload',?,0,1)").run(id, webhook, id, status);
}

describe("operations route security and input bounds", () => {
  it.each(["/search-policy", "/index", "/background", "/maintenance", "/uploads", "/failures", "/metrics", "/retention/expiring", "/budgets/history?tokenId=token"])("authorizes before any %s reads", async (path) => {
    await expect(api(path, "GET", undefined, { ...auth, permissions: ["read"] })).rejects.toMatchObject({ status: 403 });
    await expect(api(path, "GET", undefined, { ...auth, pathPrefix: "/folder" })).rejects.toMatchObject({ status: 403 });
    expect(fixture.trips).toBe(0);
  });
  it("rejects excess/malformed/duplicate mutation IDs before writing", async () => {
    for (const ids of [[], ["same", "same"], Array.from({ length: 21 }, (_, i) => `e${i}`), ["../../x"]]) {
      await expect(api("/uploads/abandon", "POST", { ids })).rejects.toHaveProperty("issues");
    }
    expect(fixture.trips).toBe(0);
  });
});

describe("#88 content indexing policy", () => {
  it("defaults to existing content indexing and performs no R2 read in metadata mode", async () => {
    expect(await api("/search-policy")).toMatchObject({ mode: "content", maxTextBytes: 1048576 });
    fixture.entry("file");
    await api("/search-policy", "PUT", { mode: "metadata", maxTextBytes: 1048576 });
    await indexFiles(1, "file");
    expect(state.get).not.toHaveBeenCalled();
    expect(fixture.sqlite.prepare("SELECT content,content_verified FROM search_documents").get()).toEqual({ content: "", content_verified: 0 });
    expect((await searchFiles(auth, { q: "file" })).results).toHaveLength(1);
  });
  it("caps bytes, isolates owners, and leaves a policy change during fetch retryable", async () => {
    fixture.entry("small"); fixture.entry("other", "/other", "bob");
    await api("/search-policy", "PUT", { mode: "content", maxTextBytes: 5 });
    await indexFiles(1, "small"); expect(state.get).not.toHaveBeenCalled();
    await indexFiles(1, "other"); expect(state.get).toHaveBeenCalledOnce();
    fixture.entry("racing");
    await api("/search-policy", "PUT", { mode: "content", maxTextBytes: 100 });
    state.get.mockImplementationOnce(async () => {
      await api("/search-policy", "PUT", { mode: "metadata", maxTextBytes: 0 });
      return { size: 10, text: async () => "body" };
    });
    await indexFiles(1, "racing");
    expect(fixture.sqlite.prepare("SELECT 1 FROM index_jobs WHERE entry_id='racing'").get()).toBeDefined();
    expect(fixture.sqlite.prepare("SELECT 1 FROM search_documents WHERE entry_id='racing'").get()).toBeUndefined();
  });
});

describe("#89 diagnostics and #90 scoped reindex", () => {
  it("uses bounded literal subtree pages and filter-bound continuations", async () => {
    for (let i = 0; i < 61; i++) fixture.entry(`e${i}`, `/100%_folder/f${String(i).padStart(3, "0")}`);
    fixture.entry("sibling", "/100%_folder-else/x"); fixture.entry("foreign", "/100%_folder/x", "bob");
    const first = await api("/index?path=/100%25_folder&state=current");
    expect(first.results).toEqual([]); expect(first.inspected).toBe(50); expect(first.nextCursor).toBeTruthy();
    const second = await api("/index?path=/100%25_folder&state=current&cursor=" + encodeURIComponent(first.nextCursor));
    expect(second.inspected).toBe(11); expect(second.nextCursor).toBeNull();
    await expect(api("/index?path=/&state=current&cursor=" + encodeURIComponent(first.nextCursor))).rejects.toMatchObject({ status: 400 });
  });
  it("previews and applies a page without resetting unrelated jobs, including changed owner", async () => {
    fixture.entry("a", "/one/a"); fixture.entry("b", "/two/b");
    fixture.sqlite.exec("UPDATE index_job_status SET attempts=3,last_error='error',next_attempt=9007199254740991");
    const preview = await api("/reindex", "POST", { path: "/one", failedOnly: true });
    expect(preview).toMatchObject({ dryRun: true, enqueued: 0, results: [{ id: "a" }] });
    expect(fixture.sqlite.prepare("SELECT attempts FROM index_job_status WHERE entry_id='a'").get()!.attempts).toBe(3);
    fixture.beforeBatch = () => { fixture.sqlite.exec("UPDATE entries SET owner_id='bob' WHERE id='a'"); fixture.beforeBatch = () => {}; };
    await expect(api("/reindex", "POST", { path: "/one", failedOnly: true, dryRun: false, reviewToken: preview.reviewToken })).rejects.toMatchObject({ status: 409 });
    expect(fixture.sqlite.prepare("SELECT attempts FROM index_job_status WHERE entry_id='b'").get()!.attempts).toBe(3);
  });
});

describe("#91 background controls, #92 failures, #93 maintenance status", () => {
  it("pauses indexing but keeps durable work, then resumes", async () => {
    fixture.entry("file");
    await api("/background", "PUT", { indexingPaused: true, webhooksPaused: true });
    expect(await indexFiles(1, "file")).toBe(0); expect(state.get).not.toHaveBeenCalled();
    expect((await api("/maintenance")).indexing).toMatchObject({ pendingAtLeast: 1, hasMore: false });
    await api("/background", "PUT", { indexingPaused: false, webhooksPaused: false });
    expect(await indexFiles(1, "file")).toBe(1);
  });
  it("lists and retries only owned live failures and enabled hooks", async () => {
    fixture.entry("file"); fixture.entry("foreign", "/foreign", "bob"); hook(); delivery("delivery", "failed");
    fixture.sqlite.exec("UPDATE index_job_status SET attempts=2,next_attempt=9007199254740991; INSERT INTO queue_failures VALUES('file','index',1,'failed'),('foreign','index',1,'foreign'),('delivery','webhook',1,'failed')");
    expect((await api("/failures")).results.map((r: any) => r.id)).toEqual(["delivery", "file"]);
    const result = await api("/failures/retry", "POST", { ids: ["file", "foreign", "delivery"] });
    expect(result.results.map((r: any) => r.status)).toEqual(["retried", "unavailable", "retried"]);
    expect(fixture.sqlite.prepare("SELECT attempts FROM index_job_status WHERE entry_id='foreign'").get()!.attempts).toBe(2);
    expect((await api("/failures")).results).toEqual([]);
  });
  it("reports lower bounds using 51 rows per queue and never reveals global state", async () => {
    for (let i = 0; i < 125; i++) fixture.entry(`e${i}`);
    fixture.entry("foreign", "/foreign", "bob"); fixture.reset();
    const result = await api("/maintenance");
    expect(result.indexing).toMatchObject({ pendingAtLeast: 50, dueAtLeast: 50, hasMore: true });
    expect(fixture.trips).toBe(1); expect(fixture.calls).toHaveLength(4);
    expect(JSON.stringify(result)).not.toContain("bob");
    expect(fixture.calls.every((c) => !/count\(\*\)/i.test(c.query))).toBe(true);
  });
});

describe("#94 upload ledger and #95 safe abandonment", () => {
  it("lists safe metadata and maintained byte progress with owner-bound pagination", async () => {
    token(); upload("direct"); upload("multi", "pending", "alice", true); upload("foreign", "pending", "bob");
    fixture.sqlite.exec("INSERT INTO upload_parts VALUES('multi',1,'digest','etag',40); UPDATE upload_parts SET size=50 WHERE upload_id='multi'");
    const result = await api("/uploads");
    expect(result.results).toHaveLength(2);
    expect(result.results.find((r: any) => r.id === "multi")).toMatchObject({ multipart: true, uploadedBytes: 50, reservedBytes: 100 });
    expect(result.results.find((r: any) => r.id === "direct").uploadedBytes).toBeNull();
    expect(JSON.stringify(result)).not.toMatch(/object_key|multipart_id|token_hash|digest|etag|foreign/);
  });
  it("defaults to preview, releases only pending reservations and never refunds usage", async () => {
    token(); upload("pending"); upload("completing", "completing"); upload("committed", "committed");
    fixture.sqlite.prepare("INSERT INTO agent_usage VALUES('token',?,7,300)").run(new Date(at).toISOString().slice(0, 10));
    expect((await api("/uploads/abandon", "POST", { ids: ["pending"] })).results[0].status).toBe("would-abandon");
    const result = await api("/uploads/abandon", "POST", { ids: ["pending", "completing", "committed", "missing"], dryRun: false });
    expect(result.results.map((r: any) => r.status)).toEqual(["abandoned", "not-pending", "not-pending", "unavailable"]);
    expect(fixture.sqlite.prepare("SELECT upload_bytes FROM agent_usage").get()!.upload_bytes).toBe(300);
    expect(fixture.sqlite.prepare("SELECT expires_at FROM uploads WHERE id='pending'").get()!.expires_at).toBe(at + 100000);
  });
  it.each(["pending", "completing", "committed", "expired", "missing"])("reconciles late direct PUT status %s without deleting bytes", async (status) => {
    token(); if (status !== "missing") upload("put", status);
    const valid = await reconcileDirectUpload("put", "put-key");
    expect(valid).toBe(["pending", "completing", "committed"].includes(status));
    expect(fixture.sqlite.prepare("SELECT count(*) AS n FROM object_gc").get()!.n).toBe(valid ? 0 : 1);
  });
});

describe("#96 budget history, #97 capacity preflight, #98 atomic controls", () => {
  it("pages token metadata with owner-bound cursors, no aggregates, and exact null/zero limits", async () => {
    for (let i = 0; i < 61; i++) token(`own${String(i).padStart(3, "0")}`);
    token("foreign", "bob"); token("revoked");
    fixture.sqlite.exec("UPDATE api_tokens SET revoked_at=1 WHERE id='revoked'; UPDATE api_tokens SET expires_at=1,paused=1,storage_limit=0,upload_limit=NULL,operation_limit=0 WHERE id='own000'");
    await expect(api("/budgets/tokens", "GET", undefined, { ...auth, pathPrefix: "/folder" })).rejects.toMatchObject({ status: 403 });
    expect(fixture.trips).toBe(0);
    const first = await api("/budgets/tokens");
    expect(first.results).toHaveLength(50); expect(first.results[0]).toEqual({ id: "own000", label: "own000", pathPrefix: "/", paused: true, storageLimit: 0, uploadLimit: null, operationLimit: 0 });
    const second = await api("/budgets/tokens?cursor=" + encodeURIComponent(first.nextCursor));
    expect(second.results).toHaveLength(11); expect(second.nextCursor).toBeNull();
    await expect(api("/budgets/tokens?cursor=" + encodeURIComponent(first.nextCursor), "GET", undefined, { ...auth, user: { ...auth.user, id: "bob" } })).rejects.toMatchObject({ status: 400 });
    expect(fixture.calls.every((r) => !/sum\(|count\(|object_usage|agent_usage/.test(r.query))).toBe(true);
  });
  it("seeks a bounded token page among ten thousand unrelated tenant tokens", async () => {
    const insert = fixture.sqlite.prepare("INSERT INTO api_tokens(id,owner_id,label,prefix,token_hash) VALUES(?,'bob','other','test',?)");
    fixture.sqlite.exec("BEGIN"); for (let i = 0; i < 10000; i++) insert.run(`other${i}`, `hash${i}`); fixture.sqlite.exec("COMMIT");
    token("mine"); fixture.sqlite.exec("ANALYZE"); fixture.reset();
    expect((await api("/budgets/tokens")).results.map((r: any) => r.id)).toEqual(["mine"]);
    expect(fixture.trips).toBe(1);
    const call = fixture.calls[0], plan = fixture.plan(call.query, call.params);
    expect(plan).toContain("tokens_owner_active_id (owner_id=? AND revoked_at=? AND id>?)");
    expect(plan).not.toContain("USE TEMP B-TREE");
  });
  it("bounds usage history to the requested UTC days and rejects foreign tokens", async () => {
    token(); token("foreign", "bob");
    for (let i = 0; i < 100; i++) fixture.sqlite.prepare("INSERT INTO agent_usage VALUES('token',?,?,?)").run(new Date(at - i * 86400000).toISOString().slice(0, 10), i, i * 10);
    const result = await api("/budgets/history?tokenId=token&days=7");
    expect(result.results).toHaveLength(7); expect(result.timezone).toBe("UTC");
    await expect(api("/budgets/history?tokenId=foreign")).rejects.toMatchObject({ status: 404 });
  });
  it("includes pending and completing bytes and is explicitly non-reserving", async () => {
    token(); upload("pending"); upload("completing", "completing"); upload("expired", "expired");
    fixture.sqlite.exec("UPDATE api_tokens SET storage_limit=250,operation_limit=1,upload_limit=0; INSERT INTO object_usage VALUES('stored','alice','token',20)");
    fixture.reset();
    const result = await api("/budgets/preflight", "POST", { tokenId: "token", operations: 2, uploadBytes: 1, storageBytes: 31 });
    expect(result).toMatchObject({ advisory: true, allowedByAgentBudget: false, remaining: { storageBytes: 30 }, used: { reservedBytes: 200 }, blockers: ["operations", "uploadBytes", "storageBytes"] });
    expect(fixture.calls).toHaveLength(1); expect(fixture.calls[0].query.trim()).toMatch(/^SELECT/);
  });
  it("makes all requested budgets change together or none, including concurrent owner changes", async () => {
    token("a"); token("b"); token("foreign", "bob");
    const update = (id: string) => ({ id, paused: true, storageLimit: 0, uploadLimit: null, operationLimit: 1 });
    await expect(api("/budgets/batch", "PUT", { updates: [update("a"), update("foreign")] })).rejects.toMatchObject({ status: 409 });
    expect(fixture.sqlite.prepare("SELECT paused FROM api_tokens WHERE id='a'").get()!.paused).toBe(0);
    fixture.beforeStatement = (q) => {
      if (q.startsWith("UPDATE api_tokens")) { fixture.beforeStatement = () => {}; fixture.sqlite.exec("UPDATE api_tokens SET owner_id='bob' WHERE id='b'"); }
    };
    await expect(api("/budgets/batch", "PUT", { updates: [update("a"), update("b")] })).rejects.toMatchObject({ status: 409 });
    expect(fixture.sqlite.prepare("SELECT paused FROM api_tokens WHERE id='a'").get()!.paused).toBe(0);
    expect(await api("/budgets/batch", "PUT", { updates: [update("a")] })).toEqual({ updated: ["a"] });
  });
});

describe("#99 metrics, #100 acknowledgements, #101 snoozes", () => {
  it("rejects oversized windows and returns complete zero-filled owner-only series", async () => {
    expect(operationMetricsSchema.safeParse({ hours: 168, bucketMinutes: 5 }).success).toBe(false);
    fixture.sqlite.prepare("INSERT INTO operation_metrics VALUES('alice',?,'api',10,2,1,300)").run(Math.floor(at / 60000));
    fixture.sqlite.prepare("INSERT INTO operation_metrics VALUES('bob',?,'api',999,999,999,999)").run(Math.floor(at / 60000));
    const result = await api("/metrics?hours=2&bucketMinutes=5");
    expect(result.results).toHaveLength(24); expect(result.results.at(-1)).toMatchObject({ requests: 10, errors: 2, averageMs: 30 });
    expect(result.results[0].averageMs).toBeNull();
  });
  it("keeps alert conditions/resolution while acknowledging and snoozing with expiry", async () => {
    fixture.sqlite.exec("INSERT INTO health_alerts VALUES('alert','alice','errors','Condition',1,NULL),('foreign','bob','errors','Private',1,NULL)");
    await api("/alerts/alert/acknowledge", "PUT", { note: "Investigating" });
    await api("/alerts/alert/snooze", "PUT", { minutes: 1 });
    expect((await health(auth)).alerts[0]).toMatchObject({ acknowledgedBy: "alice", note: "Investigating", visible: 0, resolved_at: null });
    at += 60001;
    expect((await health(auth)).alerts[0].visible).toBe(1);
    await expect(api("/alerts/foreign/acknowledge", "PUT", { note: "x" })).rejects.toMatchObject({ status: 404 });
    await api("/alerts/alert/acknowledge", "DELETE");
    expect((await health(auth)).alerts[0].acknowledgedAt).toBeNull();
  });
});

describe("#102 reference explanations, #103 retention calendar, #104 terminal history cleanup", () => {
  it("explains bounded live/recovery/pin references without exposing R2 keys", async () => {
    fixture.entry("entry", "/file", "alice", "file", "sensitive-key");
    fixture.entry("alias", "/alias", "alice", "file", "sensitive-key");
    fixture.sqlite.exec("INSERT INTO recovery VALUES('recovery','alice','group','version','/old','file',10,'text/plain','etag','sensitive-key',1,1,9999999999999); INSERT INTO snapshots VALUES('snap','alice','Snapshot','/',1,9999999999999,'alice'); INSERT INTO object_pins VALUES('alice','snap','sensitive-key',9999999999999)");
    const result = await api("/retention/references?path=/file");
    expect(result.results.map((r: any) => r.kind)).toEqual(["live", "live", "snapshot", "version"]);
    expect(JSON.stringify(result)).not.toContain("sensitive-key"); expect(state.get).not.toHaveBeenCalled();
  });
  it("paginates object-pin expiry with a stable window and owner boundary", async () => {
    for (let i = 0; i < 60; i++) fixture.sqlite.prepare("INSERT INTO object_pins VALUES('alice',?,?,?)").run(`run${i}`, `key${i}`, at + 1000);
    fixture.sqlite.prepare("INSERT INTO object_pins VALUES('bob','foreign','key',?)").run(at + 1000);
    const first = await api("/retention/expiring?days=1"); expect(first.results).toHaveLength(50);
    at += 2000;
    const next = await api("/retention/expiring?days=1&cursor=" + encodeURIComponent(first.nextCursor));
    expect(next.results).toHaveLength(10); expect(next.through).toBe(first.through); expect(next.nextCursor).toBeNull();
  });
  it("previews terminal payload bytes and rechecks status/ownership at deletion", async () => {
    hook(); hook("other", "bob"); delivery("done", "delivered"); delivery("failed", "failed"); delivery("pending"); delivery("foreign", "delivered", "other");
    expect((await api("/webhooks/cleanup", "POST", { ids: ["done", "failed", "pending", "foreign"] })).eligible).toHaveLength(2);
    fixture.beforeStatement = (q) => {
      if (q.startsWith("DELETE FROM webhook_deliveries")) { fixture.beforeStatement = () => {}; fixture.sqlite.exec("UPDATE webhook_deliveries SET status='pending' WHERE id='failed'"); }
    };
    const result = await api("/webhooks/cleanup", "POST", { ids: ["done", "failed", "pending", "foreign"], dryRun: false });
    expect(result.deleted).toEqual(["done"]); expect(fixture.sqlite.prepare("SELECT count(*) AS n FROM webhook_deliveries").get()!.n).toBe(3);
  });
});
