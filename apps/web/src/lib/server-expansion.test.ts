import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import { SQLiteSyncDialect } from "drizzle-orm/sqlite-core";
import { readFileSync } from "node:fs";
import { serverFixture } from "./server-expansion-fixture.test-utils";

const state = vi.hoisted(() => ({ fixture: null as any, put: vi.fn() }));
vi.mock("./bindings", () => ({
  requireResourceBindings: () => ({
    DB: {
      prepare: (query: string) => state.fixture.binding.prepare(query),
      batch: (queries: unknown[]) => state.fixture.binding.batch(queries),
    },
    FILES_BUCKET: { put: state.put },
  }),
  requireStringBindings: () => ({ APP_URL: "https://agfs.dev" }),
  getBindings: () => ({}),
}));
import { fileNotesApi } from "./file-notes-api";
import { collectionsApi } from "./collections-api";
import { changes } from "./changes";
import { health, evaluateHealth } from "./operations";
import { recordRecentFile } from "./recent-files";
import { validateDraftPaths } from "./draft-preflight";
import { applyDraft } from "./drafts";
import { startMultipart } from "./uploads";
import { listShares } from "./fs";
import type { RequestAuth } from "./authz";

const auth: RequestAuth = { authSource: "session", user: { id: "alice", email: "alice@example.test", name: "Alice" } };
let fixture: ReturnType<typeof serverFixture>;
beforeEach(() => {
  fixture = serverFixture(); state.fixture = fixture;
  state.put.mockReset().mockResolvedValue({ etag: "written" });
});
afterEach(() => { fixture.sqlite.close(); vi.restoreAllMocks(); });
const get = (path: string) => new Request(`https://agfs.dev/api/v1/platform${path}`);
async function body(response: Promise<Response | null>) { return (await response)!.json(); }

describe("#39 joined file-note reads", () => {
  it.each([null, "", "private text"])("reads note %j and entry in one request", async (value) => {
    fixture.entry("file");
    if (value !== null) fixture.sqlite.prepare("INSERT INTO entry_notes VALUES('file','alice',?,'alice',3,123)").run(value);
    expect(await body(fileNotesApi(get("/notes?path=/file"), auth, "/notes"))).toEqual({
      entry: { id: "file", path: "/file" }, canEdit: true,
      note: value === null ? null : { body: value, revision: 3, updatedAt: 123, author: "alice" },
    });
    expect(fixture.trips).toBe(1);
  });
  it("does not expose another owner's entry or inconsistent note", async () => {
    fixture.entry("other", "/file", "bob");
    await expect(fileNotesApi(get("/notes?path=/file"), auth, "/notes")).rejects.toMatchObject({ status: 404 });
    fixture.entry("mine", "/mine");
    fixture.sqlite.exec("INSERT INTO entry_notes VALUES('mine','bob','foreign','bob',1,123)");
    expect(await body(fileNotesApi(get("/notes?path=/mine"), auth, "/notes"))).toMatchObject({ note: null });
  });
  it("checks scoped authorization before reading and preserves revision conflicts", async () => {
    await expect(fileNotesApi(get("/notes?path=/file"), { ...auth, pathPrefix: "/allowed" }, "/notes")).rejects.toMatchObject({ status: 403 });
    expect(fixture.trips).toBe(0);
    fixture.entry("file");
    fixture.sqlite.exec("INSERT INTO entry_notes VALUES('file','alice','new','alice',2,123)");
    await expect(fileNotesApi(new Request("https://agfs.dev", {
      method: "PUT", headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: "/file", entryId: "file", body: "stale", revision: 1 }),
    }), auth, "/notes")).rejects.toMatchObject({ status: 409 });
    expect(fixture.sqlite.prepare("SELECT body FROM entry_notes").get()!.body).toBe("new");
  });
});

describe("#40 collection item snapshot", () => {
  beforeEach(() => fixture.sqlite.exec("INSERT INTO collections VALUES('collection','alice','alice','Mine',1)"));
  it("distinguishes an empty owned collection from a missing one in one call", async () => {
    expect(await body(collectionsApi(get("/collections/collection/items"), auth, "/collections/collection/items"))).toEqual({ items: [] });
    expect(fixture.trips).toBe(1);
    await expect(collectionsApi(get("/collections/missing/items"), auth, "/collections/missing/items")).rejects.toMatchObject({ status: 404 });
  });
  it("sorts and bounds results, omitting foreign entries even with inconsistent membership", async () => {
    const insert = fixture.sqlite.prepare("INSERT INTO collection_entries VALUES('collection',?)");
    for (let i = 0; i < 205; i++) { fixture.entry(`e${i}`, `/f${String(i).padStart(3, "0")}`); insert.run(`e${i}`); }
    fixture.entry("foreign", "/a", "bob"); insert.run("foreign");
    const result = await body(collectionsApi(get("/collections/collection/items"), auth, "/collections/collection/items"));
    expect(result.items).toHaveLength(200);
    expect(result.items[0].path).toBe("/f000"); expect(result.items.at(-1).path).toBe("/f199");
    expect(fixture.trips).toBe(1);
    const call = fixture.calls[0];
    expect(fixture.plan(call.query, call.params)).toContain("sqlite_autoindex_collection_entries_1 (collection_id=?)");
    expect(fixture.plan(call.query, call.params)).not.toContain("entries_owner_parent_path_idx");
  });
  it("retains actor, owner, and session boundaries", async () => {
    for (const denied of [
      { ...auth, actor: { id: "bob", email: "bob@example.test", name: "Bob" } },
      { ...auth, user: { id: "bob", email: "bob@example.test", name: "Bob" } },
    ]) await expect(collectionsApi(get("/collections/collection/items"), denied, "/collections/collection/items")).rejects.toMatchObject({ status: 404 });
    await expect(collectionsApi(get("/collections/collection/items"), { ...auth, authSource: "token" } as any, "/collections/collection/items")).rejects.toMatchObject({ status: 403 });
  });
});

describe("#41 change checkpoints", () => {
  it("reads max and retention floor in one call, isolated to the owner", async () => {
    fixture.entry("mine"); fixture.entry("other", "/other", "bob");
    expect(await changes(auth, {})).toEqual({ checkpoint: 1, changes: [], nextCursor: null });
    expect(fixture.trips).toBe(1);
    fixture.sqlite.exec("INSERT INTO change_watermarks VALUES('alice',10)");
    expect((await changes(auth, {})).checkpoint).toBe(10);
  });
  it("keeps expired and invalid cursor checks and literal path scoping", async () => {
    fixture.sqlite.exec("INSERT INTO change_watermarks VALUES('alice',5)");
    await expect(changes(auth, { since: 4 })).rejects.toMatchObject({ status: 410 });
    await expect(changes(auth, { since: 5, through: 6 })).rejects.toMatchObject({ status: 400 });
    fixture.sqlite.exec("DELETE FROM change_watermarks");
    fixture.entry("a", "/a%_/file"); fixture.entry("b", "/axb/file"); fixture.entry("c", "/a%_/other", "bob");
    fixture.reset();
    expect((await changes(auth, { path: "/a%_", since: 0 })).changes.map((row: any) => row.path)).toEqual(["/a%_/file"]);
    expect(fixture.trips).toBe(2);
  });
});

describe("#42 health read batch", () => {
  it("returns all seven sections in one transaction and excludes other owners", async () => {
    const minute = Math.floor(Date.now() / 60000);
    fixture.sqlite.prepare("INSERT INTO operation_metrics VALUES('alice',?,'api',10,1,2,500)").run(minute);
    fixture.sqlite.prepare("INSERT INTO operation_metrics VALUES('bob',?,'private',99,99,99,999)").run(minute);
    fixture.entry("mine"); fixture.entry("foreign", "/foreign", "bob");
    const result = await health(auth);
    expect(fixture.trips).toBe(1); expect(fixture.batches).toEqual([7]);
    expect(result.metrics).toEqual([{ route: "api", requests: 10, errors: 1, rejections: 2, averageMs: 50 }]);
    expect(result.indexing).toMatchObject({ pending: 1, failed: 0 });
    expect(result.jobs).toMatchObject([{ path: "/mine" }]);
    expect(result.thresholds).toEqual({ error_percent: 10, backlog: 100, latency_ms: 2000 });
    expect(result.webhooks).toEqual([]); expect(result.alerts).toEqual([]); expect(result.expiringCredentials).toEqual([]);
  });
  it("rejects non-managers before the batch", async () => {
    await expect(health({ ...auth, permissions: ["read"] })).rejects.toMatchObject({ status: 403 });
    expect(fixture.trips).toBe(0);
  });
});

describe("#43 bounded health evaluation", () => {
  it("processes 102 owners with seven calls and fixed bindings, preserving active alert identities", async () => {
    const minute = Math.floor(Date.now() / 60000);
    const metric = fixture.sqlite.prepare("INSERT INTO operation_metrics VALUES(?,?,'api',10,5,0,50000)");
    for (let i = 0; i < 101; i++) metric.run(`owner-${String(i).padStart(3, "0")}`, minute);
    fixture.sqlite.exec("INSERT INTO health_alerts VALUES('old','bob','indexing','Old backlog',1,NULL)");
    await evaluateHealth();
    expect(fixture.trips).toBe(7); expect(fixture.batches).toEqual([2, 2, 1, 2]);
    expect(Math.max(...fixture.calls.map((call) => call.params.length))).toBeLessThanOrEqual(3);
    const alerts = fixture.sqlite.prepare("SELECT id,owner_id,kind,created_at FROM health_alerts WHERE resolved_at IS NULL ORDER BY id").all();
    expect(alerts).toHaveLength(202);
    expect(fixture.sqlite.prepare("SELECT resolved_at FROM health_alerts WHERE id='old'").get()!.resolved_at).toBeTypeOf("number");
    await evaluateHealth();
    expect(fixture.sqlite.prepare("SELECT id,owner_id,kind,created_at FROM health_alerts WHERE resolved_at IS NULL ORDER BY id").all()).toEqual(alerts);
    fixture.sqlite.exec("DELETE FROM operation_metrics");
    await evaluateHealth();
    expect(fixture.sqlite.prepare("SELECT count(*) AS n FROM health_alerts WHERE resolved_at IS NULL").get()!.n).toBe(0);
  });
  it("honors custom thresholds and the ten-request minimum", async () => {
    const minute = Math.floor(Date.now() / 60000);
    fixture.sqlite.prepare("INSERT INTO operation_metrics VALUES('alice',?,'api',9,9,0,900000)").run(minute);
    fixture.sqlite.exec("INSERT INTO health_thresholds VALUES('alice',90,1,10000)");
    fixture.entry("pending");
    await evaluateHealth();
    expect(fixture.sqlite.prepare("SELECT kind FROM health_alerts WHERE resolved_at IS NULL").all()).toEqual([{ kind: "indexing" }]);
  });
  it("includes disabled-hook owners with only failed deliveries, and isolates tenant alerts", async () => {
    fixture.sqlite.exec(`INSERT INTO webhooks(id,owner_id,url,path_prefix,events,secret,created_at,enabled)
      VALUES('failed','alice','https://hooks.agfs.dev','/','[]','test',1,0),('pending','bob','https://hooks.agfs.dev','/','[]','test',1,1);
      INSERT INTO webhook_deliveries(id,webhook_id,event_id,payload,status,next_attempt,created_at)
      VALUES('df','failed','ef','{}','failed',0,1),('dp','pending','ep','{}','pending',0,1)`);
    await evaluateHealth();
    expect(fixture.sqlite.prepare("SELECT owner_id,kind FROM health_alerts WHERE resolved_at IS NULL").all()).toEqual([{ owner_id: "alice", kind: "webhooks" }]);
    fixture.sqlite.exec("UPDATE webhook_deliveries SET status='delivered' WHERE id='df'");
    await evaluateHealth();
    expect(fixture.sqlite.prepare("SELECT count(*) AS n FROM health_alerts WHERE resolved_at IS NULL").get()!.n).toBe(0);
  });
  it("exhausts empty recent-metric and job sources once despite multiple alert pages and many old files/metrics", async () => {
    const metric = fixture.sqlite.prepare("INSERT INTO operation_metrics VALUES(?,0,'api',10,0,0,1)");
    for (let i = 0; i < 1000; i++) { metric.run(`zz-old-${i}`); fixture.entry(`old-file-${i}`, `/file-${i}`, "bob"); }
    fixture.sqlite.exec("DELETE FROM index_jobs");
    const alert = fixture.sqlite.prepare("INSERT INTO health_alerts VALUES(?,?,'errors','old alert',1,NULL)");
    for (let i = 0; i < 301; i++) alert.run(`alert-${i}`, `active-${String(i).padStart(4, "0")}`);
    await evaluateHealth();
    expect(fixture.calls.filter((call) => call.query.includes("health-source-availability"))).toHaveLength(1);
    expect(fixture.calls.filter((call) => /health-source-(metrics|indexing)/.test(call.query))).toHaveLength(0);
    const evaluations = fixture.calls.filter((call) => call.query.includes("health-owner-evaluation"));
    expect(evaluations).toHaveLength(4);
    expect(evaluations.flatMap((call) => JSON.parse(call.params[1] as string))).toHaveLength(301);
    expect(fixture.sqlite.prepare("SELECT count(*) AS n FROM health_alerts WHERE resolved_at IS NULL").get()!.n).toBe(0);
    for (const call of evaluations) {
      const plan = fixture.plan(call.query, call.params);
      expect(plan).toContain("sqlite_autoindex_operation_metrics_1 (owner_id=? AND minute>?)");
      expect(plan).toContain("webhooks_owner_enabled_idx (owner_id=?)");
      expect(plan).toContain("sqlite_autoindex_webhook_deliveries_2 (webhook_id=?)");
      expect(plan).toContain("index_job_owners_owner_entry_idx (owner_id=?)");
      expect(plan).not.toContain("entries_owner_path_idx");
      expect(plan).not.toContain("operation_metrics_minute_idx");
      expect(plan).not.toContain("delivery_pending_idx");
    }
  });
  it("merges overlapping source pages in SQLite's Unicode ordering without duplicate owner evaluations", async () => {
    const owners = ["\ue000", "😀", ...Array.from({ length: 202 }, (_, i) => `owner-${String(i).padStart(3, "0")}`)];
    const metric = fixture.sqlite.prepare("INSERT INTO operation_metrics VALUES(?,?,'api',10,0,0,1)");
    const alert = fixture.sqlite.prepare("INSERT INTO health_alerts VALUES(?,?,'errors','old',1,NULL)");
    for (const owner of owners) { metric.run(owner, Math.floor(Date.now() / 60000)); alert.run(owner, owner); }
    await evaluateHealth();
    const evaluated = fixture.calls.filter((call) => call.query.includes("health-owner-evaluation")).flatMap((call) => JSON.parse(call.params[1] as string));
    const expected = fixture.sqlite.prepare("SELECT DISTINCT owner_id FROM operation_metrics ORDER BY owner_id").all().map((row) => row.owner_id);
    expect(evaluated).toEqual(expected);
    expect(new Set(evaluated).size).toBe(owners.length);
  });
  it("evaluates 5,000 owners once across 50 pages with equivalent alert decisions", async () => {
    const minute = Math.floor(Date.now() / 60000);
    const metric = fixture.sqlite.prepare("INSERT INTO operation_metrics VALUES(?,?,'api',?,?,0,?)");
    const threshold = fixture.sqlite.prepare("INSERT INTO health_thresholds VALUES(?,?,100,?)");
    const expected: { owner_id: string; kind: string }[] = [];
    for (let i = 0; i < 5000; i++) {
      const owner = `owner-${String(i).padStart(5, "0")}`, requests = i % 20 + 1;
      const errors = i % 3 === 0 ? requests : 0, duration = requests * (i % 4 === 0 ? 3000 : 500);
      const errorLimit = i % 5 === 0 ? 101 : 10, latencyLimit = i % 7 === 0 ? 4000 : 2000;
      metric.run(owner, minute, requests, errors, duration);
      threshold.run(owner, errorLimit, latencyLimit);
      if (requests >= 10 && errors * 100 / requests >= errorLimit) expected.push({ owner_id: owner, kind: "errors" });
      if (requests >= 10 && duration / requests >= latencyLimit) expected.push({ owner_id: owner, kind: "latency" });
    }
    fixture.sqlite.exec("ANALYZE");
    await evaluateHealth();
    const evaluations = fixture.calls.filter((call) => call.query.includes("health-owner-evaluation"));
    expect(evaluations).toHaveLength(50);
    expect(evaluations.every((call) => JSON.parse(call.params[1] as string).length === 100)).toBe(true);
    expect(new Set(evaluations.flatMap((call) => JSON.parse(call.params[1] as string))).size).toBe(5000);
    expect(fixture.calls.filter((call) => call.query.includes("health-source-metrics"))).toHaveLength(51);
    expect(fixture.trips).toBe(152);
    expect(fixture.sqlite.prepare("SELECT owner_id,kind FROM health_alerts WHERE resolved_at IS NULL ORDER BY owner_id,kind").all()).toEqual(expected);
  });
  it("does not restart a nonempty metric source over an old suffix while jobs and alerts supply later pages", async () => {
    const metric = fixture.sqlite.prepare("INSERT INTO operation_metrics VALUES(?,?,'api',10,0,0,1)");
    metric.run("active-0000", Math.floor(Date.now() / 60000));
    for (let i = 0; i < 10000; i++) metric.run(`zz-old-${String(i).padStart(5, "0")}`, 0);
    const user = fixture.sqlite.prepare("INSERT INTO user(id,email) VALUES(?,?)");
    const alert = fixture.sqlite.prepare("INSERT INTO health_alerts VALUES(?,?,'errors','old',1,NULL)");
    for (let i = 0; i < 501; i++) {
      const owner = `active-${String(i).padStart(4, "0")}`;
      user.run(owner, `${owner}@example.test`); fixture.entry(owner, "/file", owner); alert.run(owner, owner);
    }
    fixture.sqlite.exec("ANALYZE");
    await evaluateHealth();
    expect(fixture.calls.filter((call) => call.query.includes("health-source-metrics"))).toHaveLength(1);
    expect(fixture.calls.filter((call) => call.query.includes("health-source-indexing"))).toHaveLength(6);
    const evaluated = fixture.calls.filter((call) => call.query.includes("health-owner-evaluation")).flatMap((call) => JSON.parse(call.params[1] as string));
    expect(evaluated).toHaveLength(501); expect(new Set(evaluated).size).toBe(501);
    expect(fixture.sqlite.prepare("SELECT count(*) AS n FROM health_alerts WHERE resolved_at IS NULL").get()!.n).toBe(0);
  });
});

describe("#43 maintained index-job owner lookup", () => {
  it("backfills existing pending jobs without recreating completed jobs or resetting retries", () => {
    const old = serverFixture("0016_search_content_reuse.sql");
    try {
      old.entry("a"); old.entry("b", "/b", "bob"); old.entry("completed");
      old.sqlite.exec("DELETE FROM index_jobs WHERE entry_id='completed'; UPDATE index_job_status SET attempts=4,next_attempt=123 WHERE entry_id='a'");
      old.sqlite.exec(readFileSync(new URL("../../../../packages/db/src/migrations/0017_index_job_owners.sql", import.meta.url), "utf8"));
      expect(old.sqlite.prepare("SELECT * FROM index_job_owners ORDER BY entry_id").all()).toEqual([
        { entry_id: "a", owner_id: "alice" }, { entry_id: "b", owner_id: "bob" },
      ]);
      expect(old.sqlite.prepare("SELECT attempts,next_attempt FROM index_job_status WHERE entry_id='a'").get()).toEqual({ attempts: 4, next_attempt: 123 });
      expect(old.sqlite.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    } finally { old.sqlite.close(); }
  });
  it("tracks completion, direct requeue, and entry deletion in the same statements", () => {
    fixture.entry("a"); fixture.entry("b", "/b", "bob");
    fixture.sqlite.exec("DELETE FROM index_jobs WHERE entry_id='a'");
    expect(fixture.sqlite.prepare("SELECT * FROM index_job_owners").all()).toEqual([{ entry_id: "b", owner_id: "bob" }]);
    fixture.sqlite.exec("INSERT INTO index_jobs(entry_id) VALUES('a'); DELETE FROM entries WHERE id='b'");
    expect(fixture.sqlite.prepare("SELECT * FROM index_job_owners").all()).toEqual([{ entry_id: "a", owner_id: "alice" }]);
    expect(fixture.sqlite.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  });
  it.each([false, true])("retains owner isolation after an entry transfer, completed=%s", async (completed) => {
    fixture.entry("a");
    fixture.sqlite.exec("INSERT INTO health_thresholds VALUES('alice',10,1,2000),('bob',10,1,2000)");
    await evaluateHealth();
    if (completed) fixture.sqlite.exec("DELETE FROM index_jobs WHERE entry_id='a'");
    fixture.sqlite.exec("UPDATE entries SET owner_id='bob' WHERE id='a'");
    expect(fixture.sqlite.prepare("SELECT * FROM index_job_owners").all()).toEqual([{ entry_id: "a", owner_id: "bob" }]);
    await evaluateHealth();
    expect(fixture.sqlite.prepare("SELECT owner_id,kind FROM health_alerts WHERE resolved_at IS NULL").all()).toEqual([{ owner_id: "bob", kind: "indexing" }]);
  });
  it("rolls back the entry/job/status writes if the owner lookup cannot be maintained", () => {
    fixture.sqlite.exec("CREATE TRIGGER reject_job_owner BEFORE INSERT ON index_job_owners BEGIN SELECT RAISE(ABORT,'lookup failure'); END");
    expect(() => fixture.entry("a")).toThrow("lookup failure");
    for (const table of ["entries", "index_jobs", "index_job_status", "index_job_owners"])
      expect(fixture.sqlite.prepare(`SELECT count(*) AS n FROM ${table}`).get()!.n).toBe(0);
  });
  it.each([1, 100, 101, 1000])("seeks only the pending queue for %i jobs among unrelated files", async (jobs) => {
    for (let i = 0; i < 2000; i++) fixture.entry(`f-${i}`, `/f-${i}`, "bob");
    fixture.sqlite.prepare("DELETE FROM index_jobs WHERE entry_id NOT IN (SELECT entry_id FROM index_jobs ORDER BY entry_id LIMIT ?)").run(jobs);
    fixture.sqlite.exec("INSERT INTO health_thresholds VALUES('alice',10,1,2000),('bob',10,1,2000); ANALYZE");
    await evaluateHealth();
    expect(fixture.sqlite.prepare("SELECT owner_id,kind FROM health_alerts WHERE resolved_at IS NULL").all()).toEqual([{ owner_id: "bob", kind: "indexing" }]);
    const source = fixture.calls.find((call) => call.query.includes("health-source-indexing"))!;
    const evaluation = fixture.calls.find((call) => call.query.includes("health-owner-evaluation"))!;
    expect(fixture.plan(source.query, source.params)).toContain("index_job_owners_owner_entry_idx (owner_id>?)");
    expect(fixture.plan(evaluation.query, evaluation.params)).toContain("index_job_owners_owner_entry_idx (owner_id=?)");
    expect(fixture.plan(source.query, source.params)).not.toContain("entries");
    expect(fixture.plan(evaluation.query, evaluation.params)).not.toContain("entries");
  });
});

describe("#46, #48, #51, #54 indexed workloads", () => {
  it("uses owner share lookup and indexed revocation/view cascades", async () => {
    fixture.entry("file");
    fixture.sqlite.exec("INSERT INTO share_links(id,owner_id,entry_id,token_hash,prefix,expires_at) VALUES('share','alice','file','hash','s',9999999999999)");
    expect(await listShares("alice")).toHaveLength(1);
    const call = fixture.calls.at(-1)!;
    expect(fixture.plan(call.query, call.params)).toContain("share_links_owner_idx");
    expect(fixture.plan("DELETE FROM share_links WHERE entry_id=?", ["file"])).toContain("share_links_entry_idx");
    expect(fixture.plan("DELETE FROM share_link_views WHERE share_id=?", ["share"])).toContain("share_link_views_share_idx");
    fixture.sqlite.exec("INSERT INTO share_link_views(id,share_id) VALUES('v','share'); UPDATE entries SET r2_key='changed' WHERE id='file'");
    expect(fixture.sqlite.prepare("SELECT count(*) AS n FROM share_link_views").get()!.n).toBe(0);
  });
  it("uses the partial owner/path/fingerprint index for the production resume query", async () => {
    fixture.sqlite.prepare(`INSERT INTO uploads(id,owner_id,path,content_type,size,object_key,expires_at,multipart_id,fingerprint,condition_mode)
      VALUES('resume','alice','/resume','text/plain',10,'object',?,'multi','fingerprint','any')`).run(Date.now() + 100000);
    const result = await startMultipart(auth, { path: "/resume", size: 10, contentType: "text/plain", fingerprint: "fingerprint" });
    expect(result.uploadId).toBe("resume");
    const call = fixture.calls[0];
    expect(fixture.plan(call.query, call.params)).toContain("uploads_resume_idx (owner_id=? AND path=? AND fingerprint=?)");
    expect(fixture.calls[0].query).toContain('"expected_etag" IS');
  });
  it.each([
    ["object_pins", "expires_at", "object_pins_expiry_idx"],
    ["change_log", "created_at", "change_log_expiry_idx"],
    ["operation_metrics", "minute", "operation_metrics_minute_idx"],
    ["queue_outbox", "created_at", "queue_outbox_created_idx"],
    ["webhook_deliveries", "created_at", "webhook_deliveries_created_idx"],
    ["activity", "created_at", "activity_created_idx"],
  ])("seeks the %s retention boundary", (table, column, index) => {
    expect(fixture.plan(`SELECT rowid FROM ${table} WHERE ${column}<? LIMIT 1000`, [100])).toContain(`USING COVERING INDEX ${index}`);
  });
  it("fans out only to the current owner's enabled hooks using the index", () => {
    const insert = fixture.sqlite.prepare("INSERT INTO webhooks(id,owner_id,url,path_prefix,events,secret,created_at,enabled) VALUES(?,?,'https://hooks.agfs.dev','/allowed','[\"upload.commit\"]','secret',1,?)");
    insert.run("mine", "alice", 1); insert.run("disabled", "alice", 0); insert.run("foreign", "bob", 1);
    expect(fixture.plan("SELECT id FROM webhooks WHERE owner_id=? AND enabled=1", ["alice"])).toContain("webhooks_owner_enabled_idx (owner_id=? AND enabled=?)");
    fixture.sqlite.exec("INSERT INTO activity(id,owner_id,actor,action,path,created_at) VALUES('a','alice','Alice','upload.commit','/allowed/file',1),('b','alice','Alice','upload.commit','/allowed-other/file',2)");
    expect(fixture.sqlite.prepare("SELECT webhook_id,event_id FROM webhook_deliveries").all()).toEqual([{ webhook_id: "mine", event_id: "a" }]);
  });
});

describe("#52 atomic recent history", () => {
  it("keeps at most 100 current-actor entries in one call, without trimming another actor", async () => {
    const insert = fixture.sqlite.prepare("INSERT INTO recent_files VALUES('alice',?,?,?)");
    for (let i = 0; i < 110; i++) { fixture.entry(`e${i}`); insert.run("alice", `e${i}`, i); insert.run("bob", `e${i}`, i); }
    await recordRecentFile(auth, "e0");
    expect(fixture.trips).toBe(1); expect(fixture.batches).toEqual([2]);
    expect(fixture.sqlite.prepare("SELECT actor_id,count(*) AS n FROM recent_files GROUP BY actor_id ORDER BY actor_id").all()).toEqual([{ actor_id: "alice", n: 100 }, { actor_id: "bob", n: 110 }]);
    expect(fixture.sqlite.prepare("SELECT entry_id FROM recent_files WHERE actor_id='alice' ORDER BY opened_at DESC LIMIT 1").get()!.entry_id).toBe("e0");
  });
  it("rolls back the history write on trim failure, preserving best-effort reads", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    for (let i = 0; i < 101; i++) { fixture.entry(`e${i}`); fixture.sqlite.prepare("INSERT INTO recent_files VALUES('alice','alice',?,?)").run(`e${i}`, i); }
    fixture.sqlite.exec("CREATE TRIGGER fail_trim BEFORE DELETE ON recent_files BEGIN SELECT RAISE(ABORT,'trim failure'); END");
    await recordRecentFile(auth, "e0");
    expect(fixture.sqlite.prepare("SELECT opened_at FROM recent_files WHERE entry_id='e0'").get()!.opened_at).toBe(0);
  });
  it("does no work for token requests and cannot add foreign files", async () => {
    await recordRecentFile({ ...auth, authSource: "token" } as any, "foreign"); expect(fixture.trips).toBe(0);
    fixture.entry("foreign", "/foreign", "bob"); await recordRecentFile(auth, "foreign");
    expect(fixture.sqlite.prepare("SELECT count(*) AS n FROM recent_files").get()!.n).toBe(0);
  });
});

describe("#53 bounded draft validation", () => {
  const change = (path: string) => ({ path, operation: "write", base_exists: 0, base_etag: null });
  function draft(count = 30) {
    fixture.entry("out", "/out", "alice", "folder");
    fixture.sqlite.exec("INSERT INTO draft_sets(id,owner_id,actor_id,name,path_prefix,status,created_at) VALUES('draft','alice','alice','Draft','/out','approved',1)");
    const insert = fixture.sqlite.prepare("INSERT INTO draft_changes(draft_id,path,operation,base_exists,content) VALUES('draft',?,'write',0,'new text')");
    for (let i = 0; i < count; i++) insert.run(`/out/file-${i}`);
  }
  it("reproduces the baseline's 150 ready/parent bindings and validates 30 paths with three bindings", async () => {
    const ready = Array.from({ length: 30 }, (_, i) => sql`EXISTS(SELECT 1 FROM uploads WHERE id=${`u${i}`} AND status='pending' AND expires_at>${1})`);
    const parents = Array.from({ length: 30 }, () => sql`(${"/out"}='/' OR EXISTS(SELECT 1 FROM entries WHERE owner_id=${"alice"} AND path=${"/out"} AND kind='folder'))`);
    const old = new SQLiteSyncDialect().sqlToQuery(sql`SELECT 1 WHERE ${sql.join([...ready, ...parents], sql` AND `)}`);
    expect(old.params).toHaveLength(150);
    expect(() => fixture.binding.prepare(old.sql).bind(...old.params as any[])).toThrow("150 > 100");
    fixture.entry("out", "/out", "alice", "folder");
    await validateDraftPaths(auth, Array.from({ length: 30 }, (_, i) => change(`/out/f${i}`)));
    expect(fixture.trips).toBe(1); expect(fixture.calls[0].params).toHaveLength(3);
  });
  it("authorizes every path before reading, and rejects missing parents and changed files", async () => {
    await expect(validateDraftPaths({ ...auth, pathPrefix: "/allowed" }, [change("/allowed/a"), change("/foreign/b")])).rejects.toMatchObject({ status: 403 });
    expect(fixture.trips).toBe(0);
    fixture.entry("out", "/out", "bob", "folder");
    await expect(validateDraftPaths(auth, [change("/out/a")])).rejects.toMatchObject({ status: 409 });
    fixture.entry("file", "/file");
    await expect(validateDraftPaths(auth, [change("/file")])).rejects.toMatchObject({ status: 409 });
  });
  it("applies all 30 writes through the production transaction under the D1 bind ceiling", async () => {
    draft();
    expect(await applyDraft(auth, "draft")).toEqual({ ok: true, files: 30 });
    expect(state.put).toHaveBeenCalledTimes(30);
    expect(fixture.sqlite.prepare("SELECT count(*) AS n FROM entries WHERE kind='file'").get()!.n).toBe(30);
    expect(fixture.sqlite.prepare("SELECT count(*) AS n FROM uploads WHERE status='committed'").get()!.n).toBe(30);
    const gate = fixture.calls.find((call) => call.query.startsWith("UPDATE draft_sets SET status='applying'"))!;
    expect(gate.params.length).toBeLessThan(40);
    expect(Math.max(...fixture.calls.map((call) => call.params.length))).toBeLessThan(100);
  });
  it.each(["expired", "parent", "conflict"])("preserves transaction-time %s rejection without publishing any draft file", async (reason) => {
    draft(2);
    fixture.beforeBatch = (queries) => {
      if (!queries[0].startsWith("UPDATE draft_sets SET status='applying'")) return;
      if (reason === "expired") fixture.sqlite.exec("UPDATE uploads SET expires_at=0");
      if (reason === "parent") fixture.sqlite.exec("UPDATE entries SET kind='file' WHERE id='out'");
      if (reason === "conflict") fixture.entry("competitor", "/out/file-1");
    };
    await expect(applyDraft(auth, "draft")).rejects.toMatchObject({ status: 409 });
    expect(fixture.sqlite.prepare("SELECT status FROM draft_sets").get()!.status).toBe("approved");
    expect(fixture.sqlite.prepare("SELECT count(*) AS n FROM uploads WHERE status='committed'").get()!.n).toBe(0);
    expect(fixture.sqlite.prepare("SELECT count(*) AS n FROM entries WHERE path='/out/file-0'").get()!.n).toBe(0);
  });
});
