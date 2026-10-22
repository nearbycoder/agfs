import { beforeEach, afterEach, afterAll, describe, expect, it, vi } from "vitest";
import { serverFixture, deferred } from "./server-expansion-fixture.test-utils";
const state = vi.hoisted(() => ({ fixture: null as any, get: vi.fn() }));
vi.mock("./bindings", () => ({
  requireResourceBindings: () => ({ DB: { prepare: (q: string) => state.fixture.binding.prepare(q), batch: (q: unknown[]) => state.fixture.binding.batch(q) }, FILES_BUCKET: { get: state.get } }),
  requireStringBindings: () => ({ APP_URL: "https://agfs.dev", BETTER_AUTH_SECRET: "synthetic-local-review-signing-key" }), getBindings: () => ({}),
}));
import { indexFiles } from "./search";
import { indexingPolicy, backgroundPolicy, indexDiagnostics, reindexPlan } from "./resource-controls";
import { retentionExpiring, retentionReferences } from "./resource-controls-retention";
import { resourceControlsApi } from "./resource-controls-api";
import { requestContext } from "./request-context";
import { chargeOperation } from "./budgets";
import { OPERATIONS_CURSOR_MAX_LENGTH, indexDiagnosticsSchema } from "@agfs/contracts";
import { writeFileSync } from "node:fs";
const auth = { authSource: "session", user: { id: "alice", email: "alice@example.test", name: "Alice" } } as const;
let fixture: ReturnType<typeof serverFixture>;
const transportEvidence: unknown[] = [];
afterAll(() => writeFileSync("/tmp/agfs-server-r1-transport-20261022.json", JSON.stringify(transportEvidence, null, 2)));
beforeEach(() => { fixture = serverFixture(); state.fixture = fixture; state.get.mockReset(); });
afterEach(() => { fixture.sqlite.close(); vi.restoreAllMocks(); });

describe("R1 first-policy publication race", () => {
  it.each([{ mode: "metadata" as const, maxTextBytes: 0 }, { mode: "content" as const, maxTextBytes: 1 }])("rejects stale content on first policy creation: %o", async (policy) => {
    fixture.entry("file"); expect(fixture.sqlite.prepare("SELECT * FROM resource_policies").all()).toEqual([]);
    state.get.mockImplementationOnce(async () => { await indexingPolicy(auth, policy); return { size: 10, text: async () => "secrettext" }; });
    await indexFiles(1, "file");
    expect(fixture.sqlite.prepare("SELECT * FROM search_documents").all()).toEqual([]);
    expect(fixture.sqlite.prepare("SELECT * FROM file_search").all()).toEqual([]);
    expect(fixture.sqlite.prepare("SELECT * FROM index_jobs").all()).toHaveLength(1);
    expect(fixture.sqlite.prepare("SELECT revision FROM resource_policies").get()!.revision).toBeGreaterThan(0);
    await indexFiles(1, "file");
    expect(fixture.sqlite.prepare("SELECT content FROM search_documents").get()!.content).toBe("");
    expect(fixture.sqlite.prepare("SELECT * FROM index_jobs").all()).toEqual([]);
    expect(state.get).toHaveBeenCalledOnce();
  });
  it("allocates distinct revisions for concurrent initial writers, updates, and recreation", async () => {
    fixture.entry("file"); const gate = deferred<string>(), started = deferred();
    state.get.mockResolvedValue({ size: 10, text: async () => { started.resolve(); return gate.promise; } });
    const pending = indexFiles(1, "file"); await started.promise;
    const revisions: number[] = [];
    fixture.beforeStatement = (q) => { if (q.startsWith("SELECT index_mode AS mode")) revisions.push(fixture.sqlite.prepare("SELECT revision FROM resource_policies").get()!.revision as number); };
    const before = fixture.sqlite.prepare("SELECT value FROM resource_generation").get()!.value as number;
    await Promise.all([indexingPolicy(auth, { mode: "metadata", maxTextBytes: 0 }), indexingPolicy(auth, { mode: "content", maxTextBytes: 1 })]);
    const final = fixture.sqlite.prepare("SELECT revision FROM resource_policies").get()!.revision as number;
    expect(final).toBe(before + 2); expect(revisions.every((r) => r > 0)).toBe(true);
    await backgroundPolicy(auth, { indexingPaused: false, webhooksPaused: true });
    const changed = fixture.sqlite.prepare("SELECT revision FROM resource_policies").get()!.revision as number; expect(changed).toBeGreaterThan(final);
    fixture.sqlite.exec("DELETE FROM resource_policies"); await indexingPolicy(auth, { mode: "metadata", maxTextBytes: 0 });
    expect(fixture.sqlite.prepare("SELECT revision FROM resource_policies").get()!.revision).toBeGreaterThan(changed);
    gate.resolve("secrettext"); await pending;
    expect(fixture.sqlite.prepare("SELECT * FROM search_documents").all()).toEqual([]);
    expect(fixture.sqlite.prepare("SELECT * FROM index_jobs").all()).toHaveLength(1);
  });
  it("does not republish verified cached text across initial metadata policy creation", async () => {
    fixture.entry("file"); fixture.sqlite.exec("INSERT INTO search_documents(entry_id,object_key,content,indexed_at,content_verified) VALUES('file','file','secrettext',1,1)");
    fixture.beforeBatch = () => { fixture.beforeBatch = () => {}; fixture.sqlite.exec("INSERT INTO resource_policies(owner_id,index_mode) VALUES('alice','metadata')"); };
    await indexFiles(1, "file");
    expect(fixture.sqlite.prepare("SELECT * FROM file_search").all()).toEqual([]);
    expect(fixture.sqlite.prepare("SELECT * FROM index_jobs").all()).toHaveLength(1);
    await indexFiles(1, "file");
    expect(fixture.sqlite.prepare("SELECT content FROM file_search").get()!.content).toBe("");
    expect(state.get).not.toHaveBeenCalled();
  });
  it("uses the last exact policy identity and fails closed before integer rounding", async () => {
    fixture.sqlite.prepare("UPDATE resource_generation SET value=?").run(Number.MAX_SAFE_INTEGER - 1);
    const policy = await indexingPolicy(auth, { mode: "metadata", maxTextBytes: 0 }); expect(policy.revision).toBe(Number.MAX_SAFE_INTEGER);
    await expect(indexingPolicy(auth, { mode: "content", maxTextBytes: 1 })).rejects.toThrow(/CHECK constraint/);
    expect(await indexingPolicy(auth)).toMatchObject({ revision: Number.MAX_SAFE_INTEGER, mode: "metadata", maxTextBytes: 0 });
  });
});

const prefix = "https://agfs.dev/api/v1/platform/operations";
async function api(route: string, input?: unknown, method = input === undefined ? "GET" : "POST") {
  const response = await resourceControlsApi(new Request(prefix + route, { method,
    ...(input === undefined ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(input) }) }), auth, "/operations" + route.split("?")[0]);
  expect(response?.headers.get("cache-control")).toBe("private, no-store");
  return response!.json();
}

describe("R1 cursor transport and read-only POST", () => {
  it.each(["/" + "a".repeat(1700), "/" + "界".repeat(4090), "/" + '界"%😀'.repeat(818)])("round-trips generated pages through the bounded JSON parser at scope %#", async (path) => {
    for (let i = 0; i < 101; i++) fixture.entry(`e${i}`, `${path}/f${String(i).padStart(3, "0")}`);
    const seen: string[] = [], urls: number[] = [], bodies: number[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 3; page++) {
      const body = { path, state: "all", cursor };
      bodies.push(Buffer.byteLength(JSON.stringify(body)));
      expect(bodies.at(-1)).toBeLessThanOrEqual(16384);
      const get = new URL(prefix + "/index"); get.search = new URLSearchParams({ path, state: "all", ...(cursor ? { cursor } : {}) }).toString();
      urls.push(Buffer.byteLength(get.href));
      const result = await api("/index", body); seen.push(...result.results.map((r: any) => r.id));
      cursor = result.nextCursor ?? undefined;
      if (cursor) { expect(cursor.length).toBeLessThanOrEqual(OPERATIONS_CURSOR_MAX_LENGTH); expect(indexDiagnosticsSchema.safeParse({ ...body, cursor }).success).toBe(true); }
    }
    expect(seen).toHaveLength(101); expect(new Set(seen).size).toBe(101); expect(cursor).toBeUndefined();
    if (path.includes("界")) expect(Math.max(...urls)).toBeGreaterThan(16 * 1024); else expect(Math.max(...urls)).toBeLessThan(16 * 1024);
    // These are complete serialized URLs (origin, route, path, cursor, filters),
    // not a schema-length proxy; no provider request is made by this local test.
    transportEvidence.push({ scopeUnits: path.length, scopeKind: path.includes("界") ? path.includes('"') ? "unicode-and-escaping" : "three-byte-UTF8" : "reported-1701-ASCII", urlBytes: urls, bodyBytes: bodies });
    const first = await api("/index", { path });
    await expect(api("/index", { path, state: "failed", cursor: first.nextCursor })).rejects.toMatchObject({ status: 400 });
    await expect(indexDiagnostics({ ...auth, user: { ...auth.user, id: "bob" } }, { path, state: "all", cursor: first.nextCursor })).rejects.toMatchObject({ status: 400 });
  });
  it("keeps maximum root-relative cursors and reindex review tokens inside POST bodies", async () => {
    const path = "/" + "界".repeat(4090);
    for (let i = 0; i < 51; i++) fixture.entry(`e${i}`, `${path}/f${String(i).padStart(3, "0")}`);
    const first = await api("/index", { path: "/" });
    expect(first.nextCursor.length).toBeLessThanOrEqual(OPERATIONS_CURSOR_MAX_LENGTH);
    expect((await api("/index", { path: "/", cursor: first.nextCursor })).results).toHaveLength(1);
    const review = await api("/reindex", { path });
    expect(review.reviewToken.length).toBeLessThanOrEqual(512);
    const next = await api("/reindex", { path, cursor: review.nextCursor });
    expect(next.results).toHaveLength(1);
    const apply = { path, cursor: review.nextCursor, reviewToken: next.reviewToken, dryRun: false };
    expect(Buffer.byteLength(JSON.stringify(apply))).toBeLessThan(16384);
    expect((await api("/reindex", apply)).enqueued).toBe(1);
  });
  it.each(["/index", "/uploads", "/retention/references"])("preserves GET, auth, accounting context, parser and method boundaries for %s", async (route) => {
    vi.spyOn(Date, "now").mockReturnValue(Date.now());
    const path = "/" + "界".repeat(4095); fixture.entry("file", path);
    const url = new URL(prefix + route); url.search = new URLSearchParams({ path }).toString();
    transportEvidence.push({ scopeUnits: path.length, scopeKind: "maximum-API-path", route, urlBytes: Buffer.byteLength(url.href), bodyBytes: Buffer.byteLength(JSON.stringify({ path })) });
    const context = { auth, budgetCharged: true, burstCharged: true };
    const changes = fixture.sqlite.prepare("SELECT total_changes() AS n").get()!.n;
    await requestContext.run(context, async () => {
      const post = await api(route, { path });
      const get = await api(route + "?" + new URLSearchParams({ path }));
      expect(post).toEqual(get); expect(requestContext.getStore()).toEqual(context); expect(requestContext.getStore()?.action).toBeUndefined();
    });
    expect(fixture.sqlite.prepare("SELECT total_changes() AS n").get()!.n).toBe(changes);
    fixture.reset();
    for (const denied of [{ ...auth, permissions: ["read"] }, { ...auth, pathPrefix: "/limited" }]) {
      await expect(resourceControlsApi(new Request(prefix + route, { method: "POST", body: "malformed" }), denied as any, "/operations" + route)).rejects.toMatchObject({ status: 403 });
    }
    expect(fixture.calls).toEqual([]);
    for (const [body, contentType, status] of [[JSON.stringify({ path: "/", extra: "x".repeat(16384) }), "application/json", 413], ["{}", "text/plain", 415]] as const) {
      await expect(resourceControlsApi(new Request(prefix + route, { method: "POST", headers: { "content-type": contentType }, body }), auth, "/operations" + route)).rejects.toMatchObject({ status });
    }
    expect(fixture.calls).toEqual([]);
    expect(await resourceControlsApi(new Request(prefix + route, { method: "DELETE" }), auth, "/operations" + route)).toBeNull();
  });
  it("preserves one existing token operation charge on each GET/POST read without an audit mutation", async () => {
    fixture.sqlite.exec("INSERT INTO api_tokens(id,owner_id,label,prefix,token_hash) VALUES('token','alice','Token','p','hash')");
    const tokenAuth = { ...auth, authSource: "api-token" as const, tokenId: "token", permissions: ["manage", "read"] as Array<"manage" | "read">, pathPrefix: "/" };
    for (const method of ["GET", "POST"]) {
      // This is the unchanged auth boundary's budget charge; the read handler
      // must neither refund it, charge again, nor turn it into an audited write.
      await chargeOperation(tokenAuth);
      await requestContext.run({ auth: tokenAuth, budgetCharged: true }, async () => {
        const request = new Request(prefix + "/index", { method, ...(method === "POST" ? { headers: { "content-type": "application/json" }, body: '{"path":"/"}' } : {}) });
        await resourceControlsApi(request, tokenAuth, "/operations/index");
        expect(requestContext.getStore()?.budgetCharged).toBe(true); expect(requestContext.getStore()?.action).toBeUndefined();
      });
      expect(fixture.sqlite.prepare("SELECT operations FROM agent_usage WHERE token_id='token'").get()!.operations).toBe(method === "GET" ? 1 : 2);
    }
  });
});

describe("R1 retention evidence and expiry continuation", () => {
  it("uses execution-time expiry, preserves empty-page continuation, and reports only actual owner protections", async () => {
    let clock = 1800000000000; fixture.sqlite.function("unixepoch", () => clock / 1000);
    fixture.entry("file"); fixture.entry("foreign", "/foreign", "bob", "file", "file");
    for (let i = 0; i < 105; i++) fixture.sqlite.prepare("INSERT INTO object_pins VALUES('alice',?,'file',?)").run(`a${String(i).padStart(3, "0")}`, clock);
    fixture.sqlite.prepare("INSERT INTO object_pins VALUES('alice','z-live','file',?)").run(clock + 10000);
    fixture.sqlite.prepare("INSERT INTO object_pins VALUES('alice','z-boundary','file',?)").run(clock + 1000);
    fixture.sqlite.exec("INSERT INTO object_pins VALUES('bob','foreign-pin','file',9999999999999)");
    fixture.beforeStatement = (q) => { if (q.startsWith("WITH live")) clock = 1800000001000; };
    const first = await retentionReferences(auth, { path: "/file" }); expect(first.results.map((r) => r.kind)).toEqual(["live"]);
    const middle = await retentionReferences(auth, { path: "/file", cursor: first.nextCursor! }); expect(middle.results).toEqual([]); expect(middle.nextCursor).toBeTruthy();
    const last = await retentionReferences(auth, { path: "/file", cursor: middle.nextCursor! });
    expect(last.results.map((r) => r.referenceId)).toEqual(["z-live"]); expect(last.nextCursor).toBeNull();
    expect(fixture.sqlite.prepare("SELECT reference_id FROM object_pins WHERE owner_id='alice' AND object_key='file' AND expires_at>unixepoch()*1000").all().map((r) => r.reference_id)).toEqual(["z-live"]);
  });
  it("matches GC protection for live, recovery, snapshot and run references with expired/foreign pins excluded", async () => {
    fixture.entry("file");
    fixture.sqlite.exec("INSERT INTO recovery VALUES('recovery','alice','group','version','/old','file',10,'text/plain','etag','file',1,1,1); INSERT INTO snapshots VALUES('snap','alice','Snapshot','/',1,9999999999999,'alice'); INSERT INTO agent_runs(id,owner_id,actor_id,name,path_prefix,status,created_at) VALUES('run','alice','alice','Run','/','complete',1); INSERT INTO object_pins VALUES('alice','snap','file',9999999999999),('alice','run','file',9999999999999),('alice','expired','file',1),('bob','secret','file',9999999999999)");
    const result = await retentionReferences(auth, { path: "/file" });
    expect(result.results.map((r) => r.kind)).toEqual(["live", "run", "snapshot", "version"]);
    expect(result.results.map((r) => r.referenceId)).not.toContain("secret");
  });
  it("paginates equal-expiry ties through late and final pages with interleaved owners", async () => {
    const now = Date.now(), until = now + 86400000; vi.spyOn(Date, "now").mockReturnValue(now);
    for (let i = 0; i < 257; i++) {
      fixture.sqlite.prepare("INSERT INTO object_pins VALUES('bob',?,?,?)").run(`b${i}`, `key${i}`, now + 1000);
      fixture.sqlite.prepare("INSERT INTO object_pins VALUES('alice',?,?,?)").run(`a${i}`, `key${i}`, now + (i < 250 ? 1000 : 2000));
    }
    const seen: string[] = []; let cursor: string | undefined;
    for (let page = 0; page < 6; page++) { const result = await retentionExpiring(auth, { days: 1, cursor }); seen.push(...result.results.map((r) => r.referenceId)); cursor = result.nextCursor ?? undefined; expect(result.through).toBe(until); }
    expect(seen).toEqual(Array.from({ length: 257 }, (_, i) => `a${i}`)); expect(cursor).toBeUndefined();
    const first = await retentionExpiring(auth, { days: 1 });
    await expect(retentionExpiring(auth, { days: 2, cursor: first.nextCursor! })).rejects.toMatchObject({ status: 400 });
    await expect(retentionExpiring({ ...auth, user: { ...auth.user, id: "bob" } }, { days: 1, cursor: first.nextCursor! })).rejects.toMatchObject({ status: 400 });
    const query = fixture.calls.find((r) => r.query.startsWith("WITH same_expiry"))!;
    expect(fixture.plan(query.query, query.params)).toContain("rowid>?");
  });
});

describe("R1 reindex review binding", () => {
  const reviewInput = { path: "/scope", failedOnly: true, dryRun: true };
  function source() { fixture.entry("a", "/scope/a"); fixture.entry("b", "/scope/b"); fixture.entry("other", "/other"); fixture.sqlite.exec("UPDATE index_job_status SET attempts=3,last_error='retry',next_attempt=100"); }
  it("writes nothing on preview, authorizes before reads, and rejects an empty plan that changes before apply", async () => {
    source(); fixture.reset(); const before = fixture.sqlite.prepare("SELECT total_changes() AS n").get()!.n;
    await reindexPlan(auth, reviewInput);
    expect(fixture.sqlite.prepare("SELECT total_changes() AS n").get()!.n).toBe(before); expect(fixture.calls).toHaveLength(1); expect(fixture.batches).toEqual([]);
    fixture.reset();
    await expect(reindexPlan({ ...auth, permissions: ["read"] }, reviewInput)).rejects.toMatchObject({ status: 403 });
    expect(fixture.calls).toEqual([]);
    const input = { path: "/empty", failedOnly: false, dryRun: true }, empty = await reindexPlan(auth, input);
    expect(empty.results).toEqual([]);
    fixture.beforeBatch = () => { fixture.beforeBatch = () => {}; fixture.entry("arriving", "/empty/new"); };
    await expect(reindexPlan(auth, { ...input, dryRun: false, reviewToken: empty.reviewToken! })).rejects.toMatchObject({ status: 409 });
    expect(fixture.sqlite.prepare("SELECT * FROM resource_reindex_guard").all()).toEqual([]);
  });
  it.each([
    ["size", "UPDATE entries SET size=11 WHERE id='a'"], ["content type", "UPDATE entries SET content_type='application/json' WHERE id='a'"],
    ["object key", "UPDATE entries SET r2_key='replacement' WHERE id='a'"], ["etag", "UPDATE entries SET etag='new' WHERE id='a'"],
    ["metadata revision", "UPDATE entries SET updated_at=updated_at+1 WHERE id='a'"], ["path move", "UPDATE entries SET path='/moved' WHERE id='a'"],
    ["owner move", "UPDATE entries SET owner_id='bob' WHERE id='a'"], ["attempt", "UPDATE index_job_status SET attempts=4 WHERE entry_id='a'"],
    ["retry schedule", "UPDATE index_job_status SET next_attempt=200 WHERE entry_id='a'"], ["job recreation", "DELETE FROM index_jobs WHERE entry_id='a'; INSERT INTO index_jobs(entry_id) VALUES('a')"],
    ["first policy", "INSERT INTO resource_policies(owner_id,index_mode) VALUES('alice','metadata')"],
    ["cache eligibility", "INSERT INTO search_documents(entry_id,object_key,indexed_at,content_verified) VALUES('a','a',1,1)"],
    ["delete", "DELETE FROM entries WHERE id='a'"],
  ])("refuses a changed %s before enqueue", async (_label, change) => {
    source(); const preview = await reindexPlan(auth, reviewInput); fixture.sqlite.exec(change);
    const before = fixture.sqlite.prepare("SELECT * FROM index_job_status ORDER BY entry_id").all();
    await expect(reindexPlan(auth, { ...reviewInput, dryRun: false, reviewToken: preview.reviewToken! })).rejects.toMatchObject({ status: 409 });
    expect(fixture.sqlite.prepare("SELECT * FROM index_job_status ORDER BY entry_id").all()).toEqual(before);
    expect(fixture.sqlite.prepare("SELECT * FROM resource_reindex_guard").all()).toEqual([]);
  });
  it.each(["new entry", "delete/recreate", "policy", "owner", "expiry"])("rolls back atomically when %s changes after prevalidation", async (kind) => {
    source(); const preview = await reindexPlan(auth, reviewInput);
    fixture.beforeBatch = () => {
      fixture.beforeBatch = () => {};
      if (kind === "new entry") fixture.entry("new", "/scope/aa");
      if (kind === "delete/recreate") { fixture.sqlite.exec("DELETE FROM entries WHERE id='a'"); fixture.entry("a", "/scope/a"); }
      if (kind === "policy") fixture.sqlite.exec("INSERT INTO resource_policies(owner_id,max_text_bytes) VALUES('alice',1)");
      if (kind === "owner") fixture.sqlite.exec("UPDATE entries SET owner_id='bob' WHERE id='a'");
      if (kind === "expiry") fixture.sqlite.function("unixepoch", () => preview.reviewExpiresAt! / 1000);
    };
    await expect(reindexPlan(auth, { ...reviewInput, dryRun: false, reviewToken: preview.reviewToken! })).rejects.toMatchObject({ status: 409 });
    expect(fixture.sqlite.prepare("SELECT attempts FROM index_job_status WHERE entry_id='b'").get()!.attempts).toBe(3);
    expect(fixture.sqlite.prepare("SELECT attempts FROM index_job_status WHERE entry_id='other'").get()!.attempts).toBe(3);
    expect(fixture.sqlite.prepare("SELECT * FROM resource_reindex_guard").all()).toEqual([]);
  });
  it("binds filters, cursor, owner, expiry, signature; validates before reading and does not automatically retry", async () => {
    source(); const preview = await reindexPlan(auth, reviewInput); expect(preview.reviewToken!.length).toBeLessThanOrEqual(512);
    const input = { ...reviewInput, dryRun: false, reviewToken: preview.reviewToken! };
    fixture.reset();
    for (const altered of [{ ...input, reviewToken: undefined }, { ...input, reviewToken: input.reviewToken.slice(0, -1) + "!" }, { ...input, path: "/other" }, { ...input, failedOnly: false }])
      await expect(reindexPlan(auth, altered)).rejects.toMatchObject({ status: 409 });
    await expect(reindexPlan({ ...auth, user: { ...auth.user, id: "bob" } }, input)).rejects.toMatchObject({ status: 409 });
    vi.spyOn(Date, "now").mockReturnValue(preview.reviewExpiresAt!); await expect(reindexPlan(auth, input)).rejects.toMatchObject({ status: 409 }); vi.restoreAllMocks();
    expect(fixture.calls).toEqual([]);
    const result = await reindexPlan(auth, input); expect(result.enqueued).toBe(2); expect(result.reviewToken).toBeNull();
    // A lost response never authorizes a new page: this replay observes changed
    // retry generations and returns 409, requiring an explicit fresh review.
    await expect(reindexPlan(auth, input)).rejects.toMatchObject({ status: 409 });
    expect(fixture.sqlite.prepare("SELECT attempts FROM index_job_status WHERE entry_id='other'").get()!.attempts).toBe(3);
  });
  it("binds the input cursor and sentinel, caps 50 enqueues, and measures the complete apply batch", async () => {
    for (let i = 0; i < 101; i++) fixture.entry(`e${i}`, `/scope/${String(i).padStart(3, "0")}`);
    const input = { ...reviewInput, failedOnly: false }, preview = await reindexPlan(auth, input);
    expect(preview.results).toHaveLength(50); fixture.reset();
    await expect(reindexPlan(auth, { ...input, cursor: preview.nextCursor!, dryRun: false, reviewToken: preview.reviewToken! })).rejects.toMatchObject({ status: 409 });
    expect(fixture.calls).toEqual([]);
    const before = fixture.sqlite.prepare("SELECT total_changes() AS n").get()!.n as number;
    const result = await reindexPlan(auth, { ...input, dryRun: false, reviewToken: preview.reviewToken! });
    expect(result.enqueued).toBe(50); expect(fixture.calls).toHaveLength(5); expect(fixture.trips).toBe(2); expect(fixture.batches).toEqual([4]);
    expect(Math.max(...fixture.calls.map((c) => c.params.length))).toBeLessThanOrEqual(100); expect(state.get).not.toHaveBeenCalled();
    writeFileSync("/tmp/agfs-server-r1-reindex-cost.json", JSON.stringify({ statements: fixture.calls.length, roundTrips: fixture.trips, batchStatements: fixture.batches,
      totalChangesIncludingTriggers: Number(fixture.sqlite.prepare("SELECT total_changes() AS n").get()!.n) - before, maximumBindings: Math.max(...fixture.calls.map((c) => c.params.length)),
      boundedSnapshotCandidates: 51, snapshotEvaluations: 2, enqueued: result.enqueued, r2Operations: 0, queueSends: 0, queries: fixture.calls }, null, 2));
    const fresh = await reindexPlan(auth, input); fixture.sqlite.exec("UPDATE entries SET size=11 WHERE id='e50'");
    await expect(reindexPlan(auth, { ...input, dryRun: false, reviewToken: fresh.reviewToken! })).rejects.toMatchObject({ status: 409 });
  });
});
