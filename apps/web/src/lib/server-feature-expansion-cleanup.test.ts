import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { serverFixture } from "./server-expansion-fixture.test-utils";
import { backup } from "node:sqlite";
import { writeFileSync } from "node:fs";
const state = vi.hoisted(() => ({ fixture: null as any, abort: vi.fn(async () => {}), delete: vi.fn(async (_keys: string[]) => {}) }));
vi.mock("./bindings", () => ({ getBindings: () => ({ BACKGROUND_QUEUE: {} }), requireResourceBindings: () => ({ DB: { prepare: (q: string) => state.fixture.binding.prepare(q), batch: (q: any[]) => state.fixture.binding.batch(q) }, FILES_BUCKET: { delete: state.delete, resumeMultipartUpload: () => ({ abort: state.abort }) } }) }));
vi.mock("cloudflare:workers", () => ({ waitUntil: vi.fn() }));
vi.mock("@tanstack/react-start/server", () => ({ createStartHandler: () => vi.fn(), defaultStreamHandler: vi.fn() }));
vi.mock("@tanstack/react-start/server-entry", () => ({ createServerEntry: (entry: unknown) => entry }));
vi.mock("./background", () => ({ dispatchBackground: vi.fn(async () => {}), consumeBackground: vi.fn() }));
vi.mock("./operations", () => ({ evaluateHealth: vi.fn(async () => {}) }));
import { cleanupExpired } from "./cleanup";
import { cleanupTurn } from "./resource-controls-cleanup";
let f: ReturnType<typeof serverFixture>;
beforeEach(() => { f = serverFixture(); state.fixture = f; state.abort.mockReset(); state.abort.mockResolvedValue(); state.delete.mockReset(); state.delete.mockResolvedValue(); });
afterEach(() => { f.sqlite.close(); vi.restoreAllMocks(); });
describe("bounded hourly cleanup continuation", () => {
  it("uses the original unique upload-id index through baseline and current migrations", () => {
    for (const through of ["0000_initial.sql", "0017_index_job_owners.sql", undefined]) {
      const fixture = serverFixture(through);
      try {
        const index = fixture.sqlite.prepare("PRAGMA index_list('uploads')").all().find((row) => row.name === "sqlite_autoindex_uploads_1");
        expect(index).toMatchObject({ unique: 1, origin: "pk", partial: 0 });
        expect(fixture.sqlite.prepare("PRAGMA index_info('sqlite_autoindex_uploads_1')").all().map((row) => row.name)).toEqual(["id"]);
      } finally { fixture.sqlite.close(); }
    }
  });
  it.each([1, 10].flatMap((statisticsFrom) => ["uploads", "committed"].flatMap((task) => [1000, 100000].flatMap((count) => [false, true].map((children) => ({ statisticsFrom, task, count, children }))))))("seeks upload mutations after ANALYZE on $statisticsFrom rows then growth: $task / $count / children=$children", async ({ statisticsFrom, task, count, children }) => {
    const at = 1800000000000;
    const insert = f.sqlite.prepare("INSERT INTO uploads(id,owner_id,path,content_type,size,object_key,status,expires_at,committed_at) VALUES(?,'alice',?,'text/plain',1,?,?,?,?)");
    const part = f.sqlite.prepare("INSERT INTO upload_parts VALUES(?,1,'digest','etag',1)");
    const add = (i: number, selected = false) => {
      const id = `stale-${i}`;
      // Childful fixtures also mix unrelated statuses. Selected rows are last;
      // the childless fixture preserves the exact independent parent-only repro.
      const status = children && !selected && (statisticsFrom === 10 || i > 0) && i % 3 === 0 ? "expired" : task === "committed" ? "committed" : "pending";
      insert.run(id, `/${id}`, `key-${id}`, status, task === "committed" && statisticsFrom === 10 ? at + 3600000 : selected ? 100 : 1,
        task === "committed" ? selected ? 100 : statisticsFrom === 1 ? 1 : at : null);
      if (children || selected) part.run(id);
    };
    for (let i = 0; i < statisticsFrom; i++) add(i);
    f.sqlite.exec("ANALYZE");
    const stats = f.sqlite.prepare("SELECT * FROM sqlite_stat1 WHERE tbl='uploads'").all();
    f.sqlite.exec("BEGIN");
    for (let i = statisticsFrom; i < count; i++) add(i);
    for (let i = count; i < count + 5; i++) add(i, true);
    f.sqlite.exec("COMMIT");
    expect(f.sqlite.prepare("SELECT * FROM sqlite_stat1 WHERE tbl='uploads'").all()).toEqual(stats);
    f.sqlite.prepare("INSERT INTO resource_cleanup VALUES(?,?,?,?,'initial')").run(task, task === "committed" ? at - 7 * 86400000 : at, task === "committed" && statisticsFrom === 10 ? 0 : 100, task === "committed" && statisticsFrom === 10 ? "0" : String(count));
    const target = process.env.AGFS_CLEANUP_BENCH, prefix = target && `${target}-stale-${statisticsFrom}-${task}-${count}-${children ? 'children' : 'parents'}`;
    if (prefix) await backup(f.sqlite, `${prefix}.sqlite`);
    const trace: Array<(typeof f.calls)[number] & { trip: number }> = [];
    f.reset(); f.beforeStatement = (query, params) => { trace.push({ query, params, trip: f.trips }); };
    const before = f.sqlite.prepare("SELECT total_changes() AS n").get()!.n as number;
    await cleanupTurn(false, at);
    const changes = (f.sqlite.prepare("SELECT total_changes() AS n").get()!.n as number) - before;
    expect(f.sqlite.prepare("SELECT count(*) AS n FROM uploads").get()!.n).toBe(count);
    expect(f.sqlite.prepare("SELECT count(*) AS n FROM upload_parts").get()!.n).toBe(children ? count : 0);
    expect(f.sqlite.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    expect(changes).toBe(task === "committed" ? 23 : 48);
    const mutations = trace.filter((r) => r.query.includes("t.rowid"));
    expect(mutations.length).toBeGreaterThan(5);
    for (const row of mutations) {
      const plan = f.plan(row.query, row.params);
      expect(plan).toContain("SEARCH t USING INDEX sqlite_autoindex_uploads_1 (id=?)");
      expect(plan).not.toMatch(/SCAN (t|upload_parts)\b/);
    }
    expect(state.abort).not.toHaveBeenCalled(); expect(state.delete).not.toHaveBeenCalled();
    if (prefix) writeFileSync(`${prefix}.json`, JSON.stringify({ task, count, children, statisticsFrom, at, stats, trace, changes }, null, 2));
  });
  it.each([
    ["committed", 1000, false], ["committed", 100000, false], ["committed", 1000, true], ["committed", 100000, true],
    ["uploads", 1000, false], ["uploads", 100000, false], ["uploads", 1000, true], ["uploads", 100000, true],
  ] as const)("seeks selected %s upload rowids among %i unrelated parents (ANALYZE=%s)", async (task, count, analyzed) => {
    const at = 1800000000000;
    const upload = f.sqlite.prepare("INSERT INTO uploads(id,owner_id,path,content_type,size,object_key,status,expires_at,committed_at) VALUES(?,'alice',?,'text/plain',1,?,?,?,?)");
    const part = f.sqlite.prepare("INSERT INTO upload_parts VALUES(?,1,'digest','etag',1)");
    // Put the selected rows last: status-index scans in mutations/guards must
    // cross recent committed rows or an earlier expired pending backlog.
    f.sqlite.exec("BEGIN");
    for (let i = 0; i < count + 5; i++) {
      const id = `upload-${i}`, old = i >= count;
      upload.run(id, `/${id}`, `key-${id}`, task === "committed" ? "committed" : "pending",
        task === "uploads" ? 1 : old ? 2 : at + 3600000, task === "uploads" ? null : old ? 1 : at);
      part.run(id);
    }
    f.sqlite.exec("COMMIT");
    f.sqlite.prepare("INSERT INTO resource_cleanup VALUES(?,?,?,?, 'initial')").run(task, task === "committed" ? at - 7 * 86400000 : at, task === "committed" ? 0 : 1, task === "committed" ? "0" : String(count));
    if (analyzed) f.sqlite.exec("ANALYZE");
    const target = process.env.AGFS_CLEANUP_BENCH, prefix = target && `${target}-${task}-${count}-${analyzed ? 'analyzed' : 'raw'}`;
    if (prefix) await backup(f.sqlite, `${prefix}.sqlite`);
    const trace: Array<(typeof f.calls)[number] & { trip: number }> = [];
    f.reset(); f.beforeStatement = (query, params) => { trace.push({ trip: f.trips, query, params }); };
    const before = f.sqlite.prepare("SELECT total_changes() AS n").get()!.n as number;
    await cleanupTurn(false, at);
    const changes = (f.sqlite.prepare("SELECT total_changes() AS n").get()!.n as number) - before;
    expect(f.sqlite.prepare("SELECT count(*) AS n FROM uploads").get()!.n).toBe(count);
    expect(f.sqlite.prepare("SELECT count(*) AS n FROM upload_parts").get()!.n).toBe(count);
    expect(f.sqlite.prepare("SELECT count(*) AS n FROM uploads WHERE rowid>?").get(count)!.n).toBe(0);
    expect(f.sqlite.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    expect(changes).toBe(task === "committed" ? 23 : 48); expect(f.calls).toHaveLength(task === "committed" ? 15 : 25); expect(f.trips).toBe(3);
    expect(state.abort).not.toHaveBeenCalled(); expect(state.delete).not.toHaveBeenCalled();
    const mutations = trace.filter((row) => row.query.includes("t.rowid"));
    expect(mutations).toHaveLength(task === "committed" ? 10 : 20);
    for (const row of mutations) {
      const plan = f.plan(row.query, row.params);
      expect(plan).toContain("SEARCH t USING INDEX sqlite_autoindex_uploads_1 (id=?)");
      expect(plan).not.toContain("uploads_expiry_idx");
    }
    if (prefix) writeFileSync(`${prefix}.json`, JSON.stringify({ count, analyzed, at, trace, changes }, null, 2));
  });
  it.each(["uploads", "committed"].flatMap((task) => ["absent", "current", "stale"].map((statistics) => ({ task, statistics }))))("retires at most 25 current gapped parts with insertions/replacements: $task / $statistics", async ({ task, statistics }) => {
    const at = 1800000000000;
    f.sqlite.prepare("INSERT INTO uploads(id,owner_id,path,content_type,size,object_key,status,expires_at,committed_at) VALUES('parts','alice','/parts','text/plain',1,'parts',?,1,1)").run(task === "committed" ? "committed" : "pending");
    const insert = f.sqlite.prepare("INSERT INTO upload_parts VALUES('parts',?,'digest','etag',1)");
    for (let i = 0; i < 10; i++) insert.run(100 + i * 3);
    if (statistics === "stale") f.sqlite.exec("ANALYZE");
    for (let i = 10; i < 60; i++) insert.run(100 + i * 3);
    if (statistics === "current") f.sqlite.exec("ANALYZE");
    f.sqlite.prepare("INSERT INTO resource_cleanup VALUES(?,?,0,'0','initial')").run(task, at - 7 * 86400000);
    let current: unknown[] = [];
    f.beforeStatement = (query, params) => {
      if (!query.startsWith("DELETE FROM upload_parts")) return;
      f.sqlite.exec("DELETE FROM upload_parts WHERE upload_id='parts' AND part_number=103; UPDATE upload_parts SET etag='replacement' WHERE upload_id='parts' AND part_number=100");
      for (let part = 1; part <= 5; part++) insert.run(part);
      current = f.sqlite.prepare("SELECT part_number,etag FROM upload_parts ORDER BY part_number").all();
      const plan = f.plan(query, params);
      expect(plan).toContain("(upload_id=? AND part_number<?)");
      expect(plan).not.toMatch(/SCAN (t|upload_parts)\b/);
    };
    await cleanupTurn(false, at);
    expect(current).toHaveLength(64);
    expect(f.sqlite.prepare("SELECT part_number,etag FROM upload_parts ORDER BY part_number").all()).toEqual(current.slice(25));
    expect(f.sqlite.prepare("SELECT id FROM uploads").all()).toEqual([{ id: "parts" }]);
    expect(f.sqlite.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  });
  it("rolls back point updates, child ranges, intent and cursor together before retrying", async () => {
    const at = 1800000000000;
    f.sqlite.exec("INSERT INTO uploads(id,owner_id,path,content_type,size,object_key,expires_at) VALUES('retry','alice','/retry','text/plain',1,'retry',1)");
    for (let i = 1; i <= 31; i++) f.sqlite.prepare("INSERT INTO upload_parts VALUES('retry',?,'digest','etag',1)").run(i * 3);
    f.sqlite.prepare("INSERT INTO resource_cleanup VALUES('uploads',?,0,'0','initial')").run(at);
    const progress = f.sqlite.prepare("SELECT * FROM resource_upload_progress").all();
    f.beforeStatement = (query) => { if (query.startsWith("DELETE FROM uploads AS t")) throw new Error("after child range"); };
    await expect(cleanupTurn(false, at)).rejects.toThrow("after child range");
    expect(f.sqlite.prepare("SELECT status FROM uploads").get()!.status).toBe("pending");
    expect(f.sqlite.prepare("SELECT count(*) AS n FROM upload_parts").get()!.n).toBe(31);
    expect(f.sqlite.prepare("SELECT * FROM resource_upload_progress").all()).toEqual(progress);
    expect(f.sqlite.prepare("SELECT * FROM object_gc").all()).toEqual([]);
    expect(f.sqlite.prepare("SELECT * FROM resource_object_gc").all()).toEqual([]);
    expect(f.sqlite.prepare("SELECT revision FROM resource_cleanup").get()!.revision).toBe("initial");
    f.beforeStatement = () => {}; await cleanupTurn(false, at);
    expect(f.sqlite.prepare("SELECT count(*) AS n FROM upload_parts").get()!.n).toBe(6);
    expect(f.sqlite.prepare("SELECT status FROM uploads").get()!.status).toBe("expired");
    expect(f.sqlite.prepare("SELECT r2_key FROM resource_object_gc").all()).toEqual([{ r2_key: "retry" }]);
  });
  it("keeps committed retirement guarded against renewal, rowid reuse, status changes, and remaining parts", async () => {
    const at = 1800000000000;
    for (const id of ["renewed", "replaced", "pending", "large", "deleted"]) {
      f.sqlite.prepare("INSERT INTO uploads(id,owner_id,path,content_type,size,object_key,status,expires_at,committed_at) VALUES(?,'alice',?,'text/plain',1,?,'committed',2,1)").run(id, `/${id}`, id);
      f.sqlite.prepare("INSERT INTO upload_parts VALUES(?,1,'digest','etag',1)").run(id);
    }
    f.sqlite.prepare("INSERT INTO resource_cleanup VALUES('committed',?,0,'0','initial')").run(at - 7 * 86400000);
    f.beforeBatch = () => {
      f.beforeBatch = () => {};
      f.sqlite.prepare("UPDATE uploads SET committed_at=? WHERE id='renewed'").run(at);
      f.sqlite.exec("DELETE FROM uploads WHERE id='replaced'; INSERT INTO uploads(rowid,id,owner_id,path,content_type,size,object_key,status,expires_at,committed_at) VALUES(2,'replacement','bob','/replacement','text/plain',1,'replacement','committed',2,1); INSERT INTO upload_parts VALUES('replacement',1,'digest','etag',1); UPDATE uploads SET status='pending' WHERE id='pending'; DELETE FROM uploads WHERE id='deleted'");
      for (let part = 2; part <= 27; part++) f.sqlite.prepare("INSERT INTO upload_parts VALUES('large',?,'digest','etag',1)").run(part);
    };
    await cleanupTurn(false, at);
    expect(f.sqlite.prepare("SELECT id FROM uploads ORDER BY id").all()).toEqual(["large", "pending", "renewed", "replacement"].map((id) => ({ id })));
    expect(f.sqlite.prepare("SELECT upload_id,count(*) AS n FROM upload_parts GROUP BY upload_id ORDER BY upload_id").all()).toEqual([
      { upload_id: "large", n: 2 }, { upload_id: "pending", n: 1 }, { upload_id: "renewed", n: 1 }, { upload_id: "replacement", n: 1 },
    ]);
    expect(f.sqlite.prepare("SELECT cursor_rowid FROM resource_cleanup WHERE task='committed'").get()!.cursor_rowid).toBe("5");
    expect(f.sqlite.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    expect(state.abort).not.toHaveBeenCalled(); expect(state.delete).not.toHaveBeenCalled();
  });
  it("starts hourly eligibility and continues the real scheduled handler on following minute turns", async () => {
    const worker = (await import("../server")).default;
    const insert = f.sqlite.prepare("INSERT INTO object_pins VALUES('alice',?,?,1)");
    for (let i = 0; i < 30; i++) insert.run(`p${i}`, `k${i}`);
    for (const minute of [16, 17, 18]) {
      const pending: Promise<unknown>[] = [];
      worker.scheduled({ scheduledTime: Date.UTC(2026, 9, 22, 1, minute), cron: "* * * * *" }, {}, { waitUntil: (p) => { pending.push(p); } });
      expect(pending).toHaveLength(1); await pending[0];
      expect(f.sqlite.prepare("SELECT count(*) AS n FROM object_pins").get()!.n).toBe(minute === 16 ? 30 : minute === 17 ? 5 : 0);
    }
  });
  it("retires only one bounded pin page and continues the same backlog on later turns", async () => {
    const insert = f.sqlite.prepare("INSERT INTO object_pins VALUES('alice',?,?,1)");
    for (let i = 0; i < 101; i++) insert.run(`pin-${i}`, `object-${i}`);
    await cleanupExpired();
    expect(f.sqlite.prepare("SELECT count(*) AS n FROM object_pins").get()!.n).toBe(76);
    for (let turn = 0; turn < 5; turn++) await cleanupExpired();
    expect(f.sqlite.prepare("SELECT count(*) AS n FROM object_pins").get()!.n).toBe(0);
  });
  it("bounds a large snapshot cascade before deleting its expired parent", async () => {
    f.sqlite.exec("INSERT INTO snapshots VALUES('s','alice','snapshot','/',0,1,'alice')");
    const insert = f.sqlite.prepare("INSERT INTO snapshot_entries VALUES('s',?,'{}')");
    for (let i = 0; i < 101; i++) insert.run(`/file-${i}`);
    await cleanupExpired();
    expect(f.sqlite.prepare("SELECT count(*) AS n FROM snapshot_entries").get()!.n).toBe(76);
    expect(f.sqlite.prepare("SELECT id FROM snapshots").all()).toEqual([{ id: "s" }]);
  });
  it("writes nothing on initial empty phases and uses only one read on an idle continuation", async () => {
    const target = process.env.AGFS_CLEANUP_BENCH;
    if (target) await backup(f.sqlite, `${target}-idle.sqlite`);
    const initialTrace: unknown[] = []; f.beforeStatement = (query, params) => { initialTrace.push({ trip: f.trips, query, params }); };
    const before = f.sqlite.prepare("SELECT total_changes() AS n").get()!.n;
    await cleanupExpired();
    expect(f.sqlite.prepare("SELECT total_changes() AS n").get()!.n).toBe(before);
    f.reset(); const idleTrace: unknown[] = []; f.beforeStatement = (query, params) => { idleTrace.push({ trip: f.trips, query, params }); }; await cleanupExpired(false);
    expect(f.calls).toHaveLength(1); expect(f.trips).toBe(1); expect(state.delete).not.toHaveBeenCalled();
    expect(f.sqlite.prepare("SELECT total_changes() AS n").get()!.n).toBe(before);
    if (target) writeFileSync(`${target}-idle.json`, JSON.stringify({ initialTrace, idleTrace }, null, 2));
  });
  it("freezes cutoffs, wraps behind the cursor, and preserves renewed or valid live pins", async () => {
    let at = Date.now(); vi.spyOn(Date, "now").mockImplementation(() => at);
    const insert = f.sqlite.prepare("INSERT INTO object_pins VALUES('alice',?,?,?)");
    for (let i = 0; i < 30; i++) insert.run(`pin-${i}`, `key-${i}`, at - 100);
    insert.run("live", "live", at + 10);
    f.beforeBatch = (queries) => { if (queries.some((q) => q.includes("INSERT INTO object_gc"))) { f.beforeBatch = () => {}; f.sqlite.prepare("UPDATE object_pins SET expires_at=? WHERE reference_id='pin-0'").run(at + 10000); } };
    await cleanupExpired();
    const initial = f.sqlite.prepare("SELECT cutoff FROM resource_cleanup WHERE task='pins'").get()!.cutoff;
    expect(f.sqlite.prepare("SELECT * FROM resource_object_gc WHERE r2_key='key-0'").all()).toEqual([]);
    at += 100; insert.run("behind", "behind", at - 1000); insert.run("newly-expired", "newly-expired", at - 1);
    await cleanupExpired(false); expect(f.sqlite.prepare("SELECT cutoff FROM resource_cleanup WHERE task='pins'").get()!.cutoff).toBe(initial);
    await cleanupExpired(false); await cleanupExpired(false);
    expect(f.sqlite.prepare("SELECT reference_id FROM object_pins ORDER BY reference_id").all()).toEqual([{ reference_id: "pin-0" }]);
    await cleanupExpired(); expect(f.sqlite.prepare("SELECT reference_id FROM object_pins").all()).toEqual([{ reference_id: "pin-0" }]);
  });
  it("rolls intent, retirement, and continuation back together after any later statement fails", async () => {
    f.sqlite.exec("INSERT INTO object_pins VALUES('alice','pin','key',1)");
    f.beforeStatement = (query) => { if (query.startsWith("INSERT INTO resource_cleanup(task")) throw new Error("synthetic D1 failure"); };
    await expect(cleanupExpired()).rejects.toThrow("synthetic D1 failure");
    expect(f.sqlite.prepare("SELECT object_key FROM object_pins").all()).toEqual([{ object_key: "key" }]);
    expect(f.sqlite.prepare("SELECT * FROM resource_object_gc").all()).toEqual([]); expect(f.sqlite.prepare("SELECT * FROM resource_cleanup").all()).toEqual([]); expect(f.sqlite.prepare("SELECT * FROM resource_cleanup_guard").all()).toEqual([]);
    f.beforeStatement = () => {}; await cleanupExpired(); expect(f.sqlite.prepare("SELECT * FROM object_pins").all()).toEqual([]);
  });
  it("guards concurrent cursor advancement and does not acknowledge another turn's newer state", async () => {
    f.sqlite.exec("INSERT INTO object_pins VALUES('alice','pin','key',1)");
    f.beforeBatch = (queries) => {
      if (queries.some((q) => q.includes("INSERT INTO object_gc"))) {
        f.beforeBatch = () => {};
        f.sqlite.exec("INSERT INTO resource_cleanup VALUES('pins',2,0,'0','other-turn')");
      }
    };
    await cleanupExpired();
    expect(f.sqlite.prepare("SELECT revision FROM resource_cleanup WHERE task='pins'").get()!.revision).toBe("other-turn");
    expect(f.sqlite.prepare("SELECT * FROM object_pins").all()).toHaveLength(1);
    expect(f.sqlite.prepare("SELECT * FROM object_gc").all()).toEqual([]);
    await cleanupExpired(false); expect(f.sqlite.prepare("SELECT * FROM object_pins").all()).toEqual([]);
  });
  it("advances past failed multipart aborts and large cascades without starving later parents or other tables", async () => {
    let at = Date.now(); vi.spyOn(Date, "now").mockImplementation(() => at);
    const upload = f.sqlite.prepare("INSERT INTO uploads(id,owner_id,path,content_type,size,object_key,expires_at,multipart_id) VALUES(?,'alice',?,'text/plain',10,?,1,?)");
    for (let i = 0; i < 6; i++) upload.run(`u${i}`, `/u${i}`, `key${i}`, i === 0 ? "fail" : null);
    const parts = f.sqlite.prepare("INSERT INTO upload_parts VALUES('u1',?,'digest','etag',1)");
    for (let i = 0; i < 101; i++) parts.run(i);
    state.abort.mockRejectedValue(new Error("temporary R2 outage")); vi.spyOn(console, "error").mockImplementation(() => {});
    f.sqlite.exec("INSERT INTO object_pins VALUES('alice','pin','key-pin',1)");
    await cleanupExpired();
    expect(f.sqlite.prepare("SELECT id FROM uploads ORDER BY id").all()).toEqual([{ id: "u0" }, { id: "u1" }, { id: "u5" }]);
    expect(f.sqlite.prepare("SELECT id FROM uploads WHERE status IN ('pending','completing')").all()).toEqual([{ id: "u5" }]);
    expect(f.sqlite.prepare("SELECT status FROM uploads WHERE id='u0'").get()!.status).toBe("expired");
    expect(f.sqlite.prepare("SELECT count(*) AS n FROM upload_parts").get()!.n).toBe(76);
    expect(f.sqlite.prepare("SELECT * FROM object_pins").all()).toEqual([]);
    await cleanupExpired(false); expect(f.sqlite.prepare("SELECT id FROM uploads WHERE id='u5'").all()).toEqual([]);
    at += 60000;
    f.sqlite.prepare("INSERT INTO uploads(id,owner_id,path,content_type,size,object_key,expires_at) VALUES('new','alice','/new','text/plain',10,'new-key',?)").run(at - 1);
    for (let i = 0; i < 4; i++) await cleanupExpired(false);
    expect(f.sqlite.prepare("SELECT id FROM uploads").all()).toEqual([{ id: "u0" }]);
    state.abort.mockRejectedValue(new Error("NoSuchUpload")); await cleanupExpired(false); expect(f.sqlite.prepare("SELECT id FROM uploads").all()).toEqual([]);
  });
  it("preserves a successful commit or renewed upload during an in-flight abort and reclaims late objects through the existing GC", async () => {
    const at = Date.now();
    f.sqlite.exec("INSERT INTO uploads(id,owner_id,path,content_type,size,object_key,expires_at,multipart_id) VALUES('u','alice','/u','text/plain',10,'key',1,'multipart'); INSERT INTO upload_parts VALUES('u',1,'digest','etag',10)");
    state.abort.mockImplementationOnce(async () => { f.entry("live", "/live", "alice", "file", "key"); f.sqlite.prepare("UPDATE uploads SET status='committed',committed_at=? WHERE id='u'").run(at); });
    await cleanupExpired();
    expect(f.sqlite.prepare("SELECT status FROM uploads WHERE id='u'").get()!.status).toBe("committed"); expect(f.sqlite.prepare("SELECT * FROM upload_parts").all()).toHaveLength(1); expect(state.delete).not.toHaveBeenCalled();
    f.sqlite.exec("INSERT INTO uploads(id,owner_id,path,content_type,size,object_key,expires_at,multipart_id) VALUES('renew','alice','/renew','text/plain',10,'renew-key',1,'multipart')");
    state.abort.mockImplementationOnce(async () => { f.sqlite.prepare("UPDATE uploads SET expires_at=? WHERE id='renew'").run(at + 100000); });
    await cleanupExpired(); expect(f.sqlite.prepare("SELECT * FROM uploads WHERE id='renew'").all()).toHaveLength(1); expect(state.delete).not.toHaveBeenCalled();
  });
  it("advances owner watermarks only with the exact retired change page and rolls both back on failure", async () => {
    const insert = f.sqlite.prepare("INSERT INTO change_log(owner_id,path,operation,created_at) VALUES(?,'/','write',1)");
    for (let i = 0; i < 60; i++) insert.run(i % 2 ? "bob" : "alice");
    f.beforeStatement = (query) => { if (query.startsWith("DELETE FROM change_log")) throw new Error("delete failed"); };
    await expect(cleanupExpired()).rejects.toThrow("delete failed");
    expect(f.sqlite.prepare("SELECT * FROM change_watermarks").all()).toEqual([]); expect(f.sqlite.prepare("SELECT count(*) AS n FROM change_log").get()!.n).toBe(60);
    f.beforeStatement = () => {}; await cleanupExpired();
    expect(f.sqlite.prepare("SELECT * FROM change_watermarks ORDER BY owner_id").all()).toEqual([{ owner_id: "alice", floor: 25 }, { owner_id: "bob", floor: 24 }]);
    expect(f.sqlite.prepare("SELECT min(seq) AS first,count(*) AS n FROM change_log").get()).toMatchObject({ first: 26, n: 35 });
  });
  it("keeps equal-expiry cursors exact beyond JavaScript's safe rowid range", async () => {
    f.sqlite.exec("INSERT INTO object_pins(rowid,owner_id,reference_id,object_key,expires_at) VALUES(9007199254740992,'alice','a','a',1),(9007199254740993,'alice','b','b',1); INSERT INTO resource_cleanup VALUES('pins',2,1,'9007199254740992','large-rowid')");
    await cleanupExpired(false); expect(f.sqlite.prepare("SELECT reference_id FROM object_pins").all()).toEqual([{ reference_id: "a" }]);
    expect(f.sqlite.prepare("SELECT cursor_rowid FROM resource_cleanup WHERE task='pins'").get()!.cursor_rowid).toBe("9007199254740993");
    await cleanupExpired(false); expect(f.sqlite.prepare("SELECT * FROM object_pins").all()).toEqual([]);
    f.sqlite.exec("INSERT INTO change_log(seq,owner_id,path,operation,created_at) VALUES(9007199254740993,'alice','/','write',1)");
    await cleanupExpired();
    expect(f.sqlite.prepare("SELECT count(*) AS n FROM change_log").get()!.n).toBe(0);
    expect(f.sqlite.prepare("SELECT CAST(floor AS TEXT) AS exact FROM change_watermarks WHERE owner_id='alice'").get()!.exact).toBe("9007199254740993");
  });
  it("bounds share history cascades and fairly revisits large snapshot/share parents", async () => {
    f.entry("file");
    for (const id of ["a", "b"]) {
      f.sqlite.prepare("INSERT INTO snapshots VALUES(?,'alice','snapshot','/',0,1,'alice')").run(id);
      f.sqlite.prepare("INSERT INTO share_links(id,owner_id,entry_id,token_hash,prefix,expires_at) VALUES(?,'alice','file',?,'share',1)").run(id, id);
    }
    for (let i = 0; i < 101; i++) {
      f.sqlite.prepare("INSERT INTO snapshot_entries VALUES('a',?,'{}')").run(`/${i}`);
      f.sqlite.prepare("INSERT INTO share_link_views(id,share_id) VALUES(?,'a')").run(String(i));
    }
    await cleanupExpired();
    expect(f.sqlite.prepare("SELECT count(*) AS n FROM share_link_views").get()!.n).toBe(76);
    await cleanupExpired(false);
    expect(f.sqlite.prepare("SELECT id FROM snapshots ORDER BY id").all()).toEqual([{ id: "a" }]);
    expect(f.sqlite.prepare("SELECT id FROM share_links ORDER BY id").all()).toEqual([{ id: "a" }]);
    for (let turn = 0; turn < 4; turn++) await cleanupExpired(false);
    expect(f.sqlite.prepare("SELECT * FROM snapshots").all()).toEqual([]); expect(f.sqlite.prepare("SELECT * FROM share_links").all()).toEqual([]);
  });
  it("revokes only selected expired unconsumed device grants, atomically with their retirement", async () => {
    const at = Date.now();
    for (let i = 0; i < 31; i++) {
      f.sqlite.prepare("INSERT INTO api_tokens(id,owner_id,label,token_hash,prefix) VALUES(?,'alice','token',?,'prefix')").run(`t${i}`, `t${i}`);
      f.sqlite.prepare("INSERT INTO device_codes(device_code,user_code,api_token_id,expires_at,consumed_at) VALUES(?,?,?,?,?)").run(`d${i}`, `d${i}`, `t${i}`, i === 30 ? at + 10000 : 1, i === 0 ? 1 : null);
    }
    f.beforeStatement = (q) => { if (q.startsWith("DELETE FROM device_codes")) throw new Error("device retirement failed"); };
    await expect(cleanupExpired()).rejects.toThrow("device retirement failed");
    expect(f.sqlite.prepare("SELECT count(*) AS n FROM api_tokens WHERE revoked_at IS NOT NULL").get()!.n).toBe(0);
    f.beforeStatement = () => {}; await cleanupExpired();
    expect(f.sqlite.prepare("SELECT count(*) AS n FROM api_tokens WHERE revoked_at IS NOT NULL").get()!.n).toBe(24);
    expect(f.sqlite.prepare("SELECT revoked_at FROM api_tokens WHERE id='t0'").get()!.revoked_at).toBeNull();
    await cleanupExpired(false);
    expect(f.sqlite.prepare("SELECT count(*) AS n FROM api_tokens WHERE revoked_at IS NOT NULL").get()!.n).toBe(29);
    expect(f.sqlite.prepare("SELECT device_code FROM device_codes").all()).toEqual([{ device_code: "d30" }]);
  });
  it("tolerates old-worker pin retirement and unqualified legacy GC deletion during a new continuation", async () => {
    f.sqlite.exec("INSERT INTO object_pins VALUES('alice','pin','key',1)");
    f.beforeBatch = (queries) => {
      if (queries.some((q) => q.includes("INSERT INTO object_gc"))) {
        f.beforeBatch = () => {};
        // Exact baseline cleanup/collector SQL shapes after migration 0018.
        f.sqlite.exec("BEGIN; INSERT OR IGNORE INTO object_gc SELECT object_key,2 FROM object_pins WHERE expires_at<2; DELETE FROM object_pins WHERE expires_at<2; DELETE FROM object_gc WHERE r2_key IN ('key'); COMMIT");
      }
    };
    await cleanupExpired();
    expect(state.delete.mock.calls.flatMap((call) => call[0])).toEqual(["key"]);
    expect(f.sqlite.prepare("SELECT * FROM resource_object_gc").all()).toEqual([]);
    await cleanupExpired(false); expect(f.sqlite.prepare("SELECT * FROM resource_cleanup").all()).toEqual([]);
  });
  it.each([100, 1000])("records complete bounded convergence for %i pins and preserves GC retry intent", async (count) => {
    let at = 1800000000000; vi.spyOn(Date, "now").mockImplementation(() => at);
    const insert = f.sqlite.prepare("INSERT INTO object_pins VALUES('alice',?,?,1)");
    for (let i = 0; i < count; i++) insert.run(`pin${i}`, `key${i}`);
    const target = process.env.AGFS_CLEANUP_BENCH, prefix = target && `${target}-pins-${count}`;
    if (prefix) await backup(f.sqlite, `${prefix}.sqlite`);
    const turns: unknown[] = [];
    // First R2 failure exercises durable intents; later turns reclaim it.
    state.delete.mockRejectedValueOnce(new Error("synthetic R2 outage")); vi.spyOn(console, "error").mockImplementation(() => {});
    for (let turn = 0; turn < count / 25 + 2; turn++) {
      at = 1800000000000 + turn * 60000;
      const trace: unknown[] = []; f.reset(); f.beforeStatement = (query, params) => { trace.push({ trip: f.trips, query, params }); };
      await cleanupExpired(turn === 0); turns.push(trace);
      expect(f.calls.length).toBeLessThanOrEqual(157); expect(f.trips).toBeLessThanOrEqual(64);
    }
    expect(f.sqlite.prepare("SELECT * FROM object_pins").all()).toEqual([]);
    expect(f.sqlite.prepare("SELECT * FROM resource_object_gc").all()).toEqual([]); expect(f.sqlite.prepare("SELECT * FROM resource_cleanup").all()).toEqual([]);
    if (prefix) writeFileSync(`${prefix}.json`, JSON.stringify({ count, turns, deleteCalls: state.delete.mock.calls.map((call) => call[0].length) }, null, 2));
  });
  it("records all SQL/round trips and bounds every hourly phase, child cascade, and GC together", async () => {
    const at = Date.now(); vi.spyOn(Date, "now").mockReturnValue(at); fullFixture(at);
    const target = process.env.AGFS_CLEANUP_BENCH;
    if (target) await backup(f.sqlite, `${target}.sqlite`);
    const baselineMemory = process.memoryUsage(); let peakHeap = baselineMemory.heapUsed, peakRss = baselineMemory.rss;
    const trace: unknown[] = []; f.reset(); f.beforeStatement = (query, params) => {
      trace.push({ trip: f.trips, query, params });
      const current = process.memoryUsage(); peakHeap = Math.max(peakHeap, current.heapUsed); peakRss = Math.max(peakRss, current.rss);
    };
    const before = f.sqlite.prepare("SELECT total_changes() AS n").get()!.n as number;
    await cleanupExpired();
    const changes = (f.sqlite.prepare("SELECT total_changes() AS n").get()!.n as number) - before;
    expect(state.abort).toHaveBeenCalledTimes(5); expect(state.delete).toHaveBeenCalledOnce(); expect(state.delete.mock.calls[0][0]).toHaveLength(100);
    expect(f.calls.length).toBeLessThanOrEqual(157); expect(f.trips).toBeLessThanOrEqual(64); expect(changes).toBeLessThanOrEqual(1830);
    for (const table of ["uploads", "snapshot_entries", "snapshots", "share_link_views", "share_links", "upload_parts", "resource_upload_progress"]) expect(f.sqlite.prepare(`SELECT count(*) AS n FROM ${table}`).get()!.n).toBe(0);
    expect(f.sqlite.prepare("SELECT count(*) AS n FROM object_pins").get()!.n).toBe(5);
    expect(f.sqlite.prepare("SELECT count(*) AS n FROM resource_cleanup").get()!.n).toBe(19);
    const result = { at, trace, statements: f.calls.length, roundTrips: f.trips, changes, aborts: state.abort.mock.calls.length, deleteBatches: state.delete.mock.calls.length, deleteKeys: 100,
      sampledNodeMemory: { baselineHeap: baselineMemory.heapUsed, peakHeap, baselineRss: baselineMemory.rss, peakRss, caveat: "Includes SQLite/test runtime/retained SQL trace; sampling can miss peaks. Not Worker memory or a bound." },
      maxSqlBindings: Math.max(...f.calls.map((c) => c.params.length)), maxStringBindingBytes: Math.max(...f.calls.flatMap((c) => c.params.filter((p) => typeof p === "string").map((p) => Buffer.byteLength(String(p))))) };
    f.reset(); const continuation: unknown[] = []; f.beforeStatement = (query, params) => { continuation.push({ trip: f.trips, query, params }); }; await cleanupExpired(false);
    if (target) writeFileSync(`${target}.json`, JSON.stringify({ ...result, continuation }, null, 2));
  });
});

function fullFixture(at: number) {
  f.sqlite.exec("INSERT INTO workspaces(id,name,created_by,created_at) VALUES('alice','Workspace','alice',1); INSERT INTO webhooks(id,owner_id,url,path_prefix,events,secret,created_at) VALUES('hook','alice','https://example.com','/','[]','synthetic',1)");
  f.entry("share-file");
  const token = f.sqlite.prepare("INSERT INTO api_tokens(id,owner_id,label,token_hash,prefix) VALUES(?,'alice','token',?,?)");
  for (let i = 0; i < 30; i++) {
    const id = `row-${String(i).padStart(3, "0")}`; token.run(id, id, id);
    f.sqlite.prepare("INSERT INTO object_pins VALUES('alice',?,?,1)").run(id, id);
    f.sqlite.prepare("INSERT INTO recovery VALUES(?,'alice',?,'version',?,'file',1,'text/plain','etag',?,0,0,1)").run(id, id, `/${id}`, `recovery-${id}`);
    f.sqlite.prepare("INSERT INTO token_rotation_aliases VALUES(?,?,1)").run(id, id);
    f.sqlite.prepare("INSERT INTO webhooks(id,owner_id,url,path_prefix,events,secret,created_at,previous_secret,previous_secret_until) VALUES(?,'alice','https://example.com','/','[]','synthetic',0,'old',1)").run(id);
    f.sqlite.prepare("INSERT INTO idempotency VALUES('alice',?,'f',200,'{}',1)").run(id);
    f.sqlite.prepare("INSERT INTO change_log(owner_id,path,operation,created_at) VALUES(?,'/','write',1)").run(id);
    f.sqlite.prepare("INSERT INTO operation_metrics(owner_id,minute,route) VALUES(?,0,'/')").run(id);
    // Transfer PK is a workspace: one distinct workspace each avoids fixtures
    // that accidentally benchmark a same-row UPDATE instead of retirement.
    f.sqlite.prepare("INSERT INTO user(id,email) VALUES(?,?)").run(id, `${id}@example.test`);
    f.sqlite.prepare("INSERT INTO workspaces(id,name,created_by,created_at) VALUES(?,'Workspace','alice',1)").run(id);
    f.sqlite.prepare("INSERT INTO ownership_transfers VALUES(?,'alice','bob',1)").run(id);
    f.sqlite.prepare("INSERT INTO queue_outbox VALUES(?,'index',1,NULL)").run(id);
    f.sqlite.prepare("INSERT INTO health_alerts VALUES(?,'alice',?,'alert',0,1)").run(id, id);
    f.sqlite.prepare("INSERT INTO resource_alert_state(alert_id) VALUES(?)").run(id);
    f.sqlite.prepare("INSERT INTO webhook_deliveries(id,webhook_id,event_id,payload,attempts,status,next_attempt,created_at) VALUES(?,'hook',?,'{}',8,'failed',0,1)").run(id, id);
    f.sqlite.prepare("INSERT INTO workspace_invites VALUES(?,'alice','invite@example.test','viewer',?,'alice',1)").run(id, id);
    f.sqlite.prepare("INSERT INTO agent_usage(token_id,day) VALUES(?,'2000-01-01')").run(id);
    f.sqlite.prepare("INSERT INTO device_codes(device_code,user_code,owner_id,api_token_id,expires_at) VALUES(?,?,'alice',?,1)").run(id, id, id);
    f.sqlite.prepare("INSERT INTO activity VALUES(?,'alice','fixture','/','alice',NULL,1)").run(id);
  }
  f.sqlite.exec("INSERT INTO snapshots VALUES('snapshot','alice','snapshot','/',0,1,'alice'); INSERT INTO share_links(id,owner_id,entry_id,token_hash,prefix,expires_at) VALUES('share','alice','share-file','share','share',1)");
  for (let i = 0; i < 25; i++) {
    f.sqlite.prepare("INSERT INTO snapshot_entries VALUES('snapshot',?,'{}')").run(`/${i}`);
    f.sqlite.prepare("INSERT INTO share_link_views(id,share_id,viewed_at) VALUES(?,'share',1)").run(String(i));
  }
  for (let i = 0; i < 10; i++) {
    f.sqlite.prepare("INSERT INTO uploads(id,owner_id,path,content_type,size,object_key,status,expires_at,committed_at,multipart_id) VALUES(?,'alice',?,'text/plain',25,?,?,1,1,?)").run(`upload${i}`, `/upload${i}`, `upload-key${i}`, i < 5 ? "pending" : "committed", i < 5 ? `multipart${i}` : null);
    for (let part = 0; part < 25; part++) f.sqlite.prepare("INSERT INTO upload_parts VALUES(?,?,'digest','etag',1)").run(`upload${i}`, part);
  }
  for (let i = 0; i < 100; i++) {
    f.sqlite.prepare("INSERT INTO object_usage VALUES(?,'alice','row-000',1)").run(`gc${i}`);
    f.sqlite.prepare("INSERT INTO object_gc VALUES(?,0)").run(`gc${i}`);
  }
}
