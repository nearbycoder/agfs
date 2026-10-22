import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { sql, type SQL } from "drizzle-orm";
import { SQLiteSyncDialect } from "drizzle-orm/sqlite-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ database: null as any, remove: vi.fn(), head: vi.fn(), sendBatch: vi.fn() }));
vi.mock("./bindings", () => ({
  requireResourceBindings: () => ({
    DB: {
      prepare: (query: string) => state.database.prepare(query),
      batch: (queries: unknown[]) => state.database.batch(queries),
    },
    FILES_BUCKET: { delete: state.remove, head: state.head },
  }),
  getBindings: () => ({ BACKGROUND_QUEUE: { sendBatch: state.sendBatch } }),
}));
import { ensureFolderChain, deleteEntry, treeEntries } from "./fs";
import { createRun, finishRun } from "./runs";
import { collectGarbage } from "./garbage";
import { dispatchBackground } from "./background";
import { pathRange } from "./path-range";
import { storageUsageSql } from "./storage-usage";
import type { RequestAuth } from "./authz";

let database: DatabaseSync;
let calls: Array<{ query: string; params: SQLInputValue[] }>;
let roundTrips: number;
let beforeBatch: () => void;
const auth: RequestAuth = {
  authSource: "session",
  user: { id: "alice", email: "alice@example.test", name: "Alice" },
};
const migrations = new URL("../../../../packages/db/src/migrations/", import.meta.url);
beforeEach(() => {
  database = new DatabaseSync(":memory:");
  database.exec("PRAGMA foreign_keys=ON");
  for (const file of readdirSync(migrations).filter((f) => f.endsWith(".sql")).sort())
    database.exec(readFileSync(new URL(file, migrations), "utf8"));
  database.exec("INSERT INTO user(id,email) VALUES('alice','alice@example.test'),('bob','bob@example.test')");
  calls = [];
  roundTrips = 0;
  beforeBatch = () => {};
  state.remove.mockReset().mockResolvedValue(undefined);
  state.head.mockReset().mockResolvedValue({ etag: "etag", checksums: { sha256: new Uint8Array(32).fill(0xab).buffer } });
  state.sendBatch.mockReset().mockResolvedValue(undefined);
  function prepare(query: string) {
    let params: SQLInputValue[] = [];
    const statement = {
      bind(...values: SQLInputValue[]) {
        if (values.length > 100) throw new Error("D1 supports at most 100 bound parameters");
        params = values;
        return statement;
      },
      execute() {
        calls.push({ query, params });
        const results = database.prepare(query).all(...params);
        return { results, success: true, meta: { changes: Number(database.prepare("SELECT changes() AS n").get()!.n) } };
      },
      async all() { roundTrips++; return statement.execute(); },
      async run() { roundTrips++; return statement.execute(); },
      async raw() { roundTrips++; return statement.execute().results.map((row) => Object.values(row)); },
    };
    return statement;
  }
  state.database = {
    prepare,
    async batch(queries: ReturnType<typeof prepare>[]) {
      roundTrips++;
      beforeBatch();
      database.exec("BEGIN");
      try {
        const result = queries.map((q) => q.execute());
        database.exec("COMMIT");
        return result;
      } catch (error) {
        database.exec("ROLLBACK");
        throw error;
      }
    },
  };
});
afterEach(() => {
  database.close();
  vi.restoreAllMocks();
});
function entry(id: string, path: string, kind = "file", owner = "alice", key: string | null = id) {
  database.prepare(`INSERT INTO entries(id,owner_id,path,parent_path,name,kind,size,r2_key,etag)
    VALUES(?,?,?,?,?,?,10,?,'etag')`).run(id, owner, path, path.slice(0, path.lastIndexOf("/")) || "/", path.split("/").at(-1)!, kind, kind === "folder" ? null : key);
}
function execute(statement: SQL) {
  const q = new SQLiteSyncDialect().sqlToQuery(statement);
  return database.prepare(q.sql).all(...q.params as SQLInputValue[]);
}

describe("folder-chain batching", () => {
  it("creates a 100-level chain in one transaction with bounded bindings, and is idempotent", async () => {
    const path = "/a".repeat(100);
    await ensureFolderChain("alice", path);
    expect(roundTrips).toBe(1);
    expect(calls).toHaveLength(2);
    expect(Math.max(...calls.map((c) => c.params.length))).toBeLessThan(10);
    expect(database.prepare("SELECT count(*) AS n FROM entries").get()!.n).toBe(100);
    expect(database.prepare("SELECT count(*) AS n FROM change_log").get()!.n).toBe(100);
    const entries = database.prepare("SELECT * FROM entries ORDER BY path").all();
    await ensureFolderChain("alice", path);
    expect(database.prepare("SELECT * FROM entries ORDER BY path").all()).toEqual(entries);
    expect(database.prepare("SELECT count(*) AS n FROM change_log").get()!.n).toBe(100);
  });
  it("does no database work for the root", async () => {
    await ensureFolderChain("alice", "/");
    expect(roundTrips).toBe(0);
  });
  it("rejects file ancestors without partial folder creation, including a file inserted just before execution", async () => {
    beforeBatch = () => entry("block", "/a/b");
    await expect(ensureFolderChain("alice", "/a/b/c")).rejects.toMatchObject({ status: 400 });
    expect(database.prepare("SELECT path FROM entries").all()).toEqual([{ path: "/a/b" }]);
  });
  it("preserves existing folders and isolates owners and literal names", async () => {
    entry("other", "/a%_", "file", "bob");
    entry("parent", "/a%_", "folder");
    await ensureFolderChain("alice", "/a%_/é'文");
    expect(database.prepare("SELECT id FROM entries WHERE owner_id='alice' AND path='/a%_'").get()!.id).toBe("parent");
    expect(database.prepare("SELECT path FROM entries WHERE owner_id='alice' ORDER BY path").all()).toEqual([{ path: "/a%_" }, { path: "/a%_/é'文" }]);
  });
  it("rolls back the entire chain if any insert fails", async () => {
    database.exec("CREATE TRIGGER fail_chain BEFORE INSERT ON entries WHEN NEW.path='/a/b' BEGIN SELECT RAISE(ABORT,'failed'); END");
    await expect(ensureFolderChain("alice", "/a/b/c")).rejects.toThrow("failed");
    expect(database.prepare("SELECT count(*) AS n FROM entries").get()!.n).toBe(0);
    expect(database.prepare("SELECT count(*) AS n FROM change_log").get()!.n).toBe(0);
  });
});

describe("indexed literal subtree reads", () => {
  it.each(["/", "/a", "/a%_", "/A", "/é文😀"])("matches the original exact-prefix predicate for %s", (path) => {
    const paths = new Set(["/", "/a", "/A", "/a%_", "/axb", "/é文😀", path, `${path}/child`, `${path}.neighbor`, `${path}-neighbor`, `${path}0/neighbor`, `${path}/文😀`].map((p) => p.replace(/\/+/g, "/")));
    [...paths].forEach((p, i) => entry(String(i), p));
    entry("other", path, "file", "bob");
    const prefix = path === "/" ? "/" : `${path}/`;
    for (const self of [false, true]) {
      const original = execute(sql`SELECT path FROM entries WHERE owner_id='alice' AND (${self ? 1 : 0}=1 AND path=${path} OR substr(path,1,length(${prefix}))=${prefix}) ORDER BY path`);
      const actual = execute(sql`SELECT path FROM entries WHERE owner_id='alice' AND ${pathRange(sql`path`, path, self)} ORDER BY path`);
      expect(actual).toEqual(original);
    }
  });
  it("uses owner/path lower and upper bounds, and tree reads keep hierarchy", async () => {
    entry("folder", "/scope", "folder");
    entry("nested", "/scope/nested", "folder");
    entry("file", "/scope/nested/file");
    entry("neighbor", "/scope-other/file");
    const plan = execute(sql`EXPLAIN QUERY PLAN SELECT * FROM entries WHERE owner_id='alice' AND ${pathRange(sql`path`, "/scope", true)} ORDER BY path`);
    expect(plan.some((r) => String(r.detail).includes("entries_owner_path_idx (owner_id=? AND path>? AND path<?)"))).toBe(true);
    const tree = await treeEntries("alice", "/scope");
    expect(tree.map((n) => n.path)).toEqual(["/scope/nested"]);
    expect(tree[0].children).toMatchObject([{ path: "/scope/nested/file" }]);
  });
});

describe("run input capture", () => {
  const start = (inputs: string[], requestAuth = auth) => createRun(requestAuth, { inputs, path: "/out", name: "Run", metadata: {} });
  it("captures all 50 supported inputs with one read and a three-statement atomic batch", async () => {
    const inputs = Array.from({ length: 50 }, (_, i) => `/input-${i}`);
    inputs.forEach((path, i) => entry(`e${i}`, path));
    const run = await start(inputs);
    expect(roundTrips).toBe(2);
    expect(calls).toHaveLength(4);
    expect(Math.max(...calls.map((c) => c.params.length))).toBe(12);
    expect(JSON.parse(database.prepare("SELECT inputs FROM agent_runs WHERE id=?").get(run.id)!.inputs as string).map((e: any) => e.path)).toEqual(inputs);
    expect(database.prepare("SELECT count(*) AS n FROM run_artifacts").get()!.n).toBe(50);
    expect(database.prepare("SELECT count(*) AS n FROM object_pins").get()!.n).toBe(50);
  });
  it("retains order and duplicates without duplicating pins", async () => {
    entry("a", "/a"); entry("b", "/b");
    const run = await start(["/b", "/a", "/b"]);
    expect(JSON.parse(database.prepare("SELECT inputs FROM agent_runs WHERE id=?").get(run.id)!.inputs as string).map((e: any) => e.path)).toEqual(["/b", "/a", "/b"]);
    expect(database.prepare("SELECT count(*) AS n FROM object_pins").get()!.n).toBe(2);
  });
  it("rejects foreign, missing and folder inputs without creating a run", async () => {
    entry("foreign", "/foreign", "file", "bob"); entry("folder", "/folder", "folder");
    for (const path of ["/foreign", "/missing", "/folder"])
      await expect(start([path])).rejects.toMatchObject({ status: 404 });
    expect(database.prepare("SELECT count(*) AS n FROM agent_runs").get()!.n).toBe(0);
  });
  it("authorizes every input before any read", async () => {
    await expect(start(["/out/allowed", "/private"], { ...auth, authSource: "api-token", pathPrefix: "/out", permissions: ["read", "write"] })).rejects.toMatchObject({ status: 403 });
    expect(roundTrips).toBe(0);
  });
  it.each(["UPDATE entries SET r2_key='changed' WHERE id='a'", "UPDATE entries SET path='/private' WHERE id='a'", "DELETE FROM entries WHERE id='a'"])("keeps run and pins absent after an input race: %s", async (mutation) => {
    entry("a", "/a");
    beforeBatch = () => database.exec(mutation);
    await expect(start(["/a"])).rejects.toMatchObject({ status: 409 });
    for (const table of ["agent_runs", "run_artifacts", "object_pins"])
      expect(database.prepare(`SELECT count(*) AS n FROM ${table}`).get()!.n).toBe(0);
  });
  it("supports inputless runs without a preflight read", async () => {
    await start([]);
    expect(roundTrips).toBe(1);
    expect(database.prepare("SELECT count(*) AS n FROM agent_runs").get()!.n).toBe(1);
  });
});

describe("run completion batching", () => {
  const start = (inputs: string[] = []) => createRun(auth, { inputs, path: "/out", name: "Run", metadata: {}, retentionDays: 7 });
  const pins = () => database.prepare("SELECT * FROM object_pins ORDER BY reference_id,object_key").all();
  function unfinished(id: string) {
    expect(database.prepare("SELECT status,manifest,completed_at FROM agent_runs WHERE id=?").get(id)).toEqual({ status: "running", manifest: null, completed_at: null });
    expect(database.prepare("SELECT count(*) AS n FROM run_artifacts WHERE run_id=? AND kind='output'").get(id)!.n).toBe(0);
  }
  it.each([0, 200])("completes 50 inputs and %i outputs with bounded bindings and three atomic writes", async (outputCount) => {
    const inputs = Array.from({ length: 50 }, (_, i) => `/input-${i}`);
    inputs.forEach((path, i) => entry(`input-${i}`, path));
    for (let i = 0; i < outputCount; i++) entry(`output-${i}`, `/out/file-${i}`);
    const run = await start(inputs);
    calls = []; roundTrips = 0;
    const { manifest } = await finishRun(auth, run.id);
    expect(roundTrips).toBe(3);
    expect(calls).toHaveLength(5);
    expect(Math.max(...calls.map((c) => c.params.length))).toBe(19);
    expect(manifest.inputs.map((input: any) => input.path)).toEqual(inputs);
    expect(manifest.artifacts).toHaveLength(outputCount);
    for (const output of manifest.artifacts) expect(output.checksum).toBe("ab".repeat(32));
    expect(state.head).toHaveBeenCalledTimes(outputCount);
    expect(database.prepare("SELECT count(*) AS n FROM run_artifacts WHERE run_id=?").get(run.id)!.n).toBe(50 + outputCount);
    const pins = database.prepare("SELECT expires_at FROM object_pins WHERE reference_id=?").all(run.id);
    expect(pins).toHaveLength(50 + outputCount);
    expect(pins.every((pin) => pin.expires_at === Date.parse(manifest.retainedUntil))).toBe(true);
    expect(Date.parse(manifest.retainedUntil) - Date.parse(manifest.completedAt)).toBe(7 * 86400000);
    expect(database.prepare("SELECT completed_at FROM agent_runs WHERE id=?").get(run.id)!.completed_at).toBe(Date.parse(manifest.completedAt));
  });
  it("preserves repeated input order and shared object keys without duplicate pins", async () => {
    entry("a", "/out/a", "file", "alice", "shared");
    entry("b", "/out/b", "file", "alice", "shared");
    const inputs = ["/out/b", "/out/a", "/out/b"];
    const run = await start(inputs);
    const { manifest } = await finishRun(auth, run.id);
    expect(manifest.inputs.map((input: any) => input.path)).toEqual(inputs);
    expect(manifest.artifacts.map((output: any) => output.path)).toEqual(["/out/a", "/out/b"]);
    expect(database.prepare("SELECT count(*) AS n FROM run_artifacts").get()!.n).toBe(4);
    expect(pins()).toEqual([{ owner_id: "alice", reference_id: run.id, object_key: "shared", expires_at: Date.parse(manifest.retainedUntil) }]);
    expect(JSON.stringify(manifest)).not.toContain("shared");
  });
  it.each([
    "UPDATE entries SET r2_key='replacement' WHERE id='output'",
    "UPDATE entries SET path='/elsewhere' WHERE id='output'",
    "DELETE FROM entries WHERE id='output'",
    "UPDATE entries SET etag='changed' WHERE id='output'",
    "UPDATE entries SET size=11 WHERE id='output'",
    "UPDATE entries SET content_type='changed' WHERE id='output'",
    "UPDATE entries SET updated_at=updated_at+1 WHERE id='output'",
    "UPDATE entries SET kind='folder' WHERE id='output'",
  ])("rejects changed output snapshots without renewing pins: %s", async (mutation) => {
    entry("input", "/input"); entry("output", "/out/file");
    const run = await start(["/input"]), originalPins = pins();
    beforeBatch = () => database.exec(mutation);
    await expect(finishRun(auth, run.id)).rejects.toMatchObject({ status: 409 });
    unfinished(run.id);
    expect(pins()).toEqual(originalPins);
  });
  it.each([false, true])("rejects added outputs even when the captured set is empty: existing=%s", async (existing) => {
    if (existing) entry("output", "/out/file");
    const run = await start();
    beforeBatch = () => entry("new", "/out/added");
    await expect(finishRun(auth, run.id)).rejects.toMatchObject({ status: 409 });
    unfinished(run.id);
    expect(pins()).toEqual([]);
  });
  it.each(["deleted", "overwritten", "moved", "live with expired pin"])("retains available input snapshots: %s", async (change) => {
    entry("input", "/input");
    const run = await start(["/input"]);
    beforeBatch = () => {
      if (change === "deleted") database.exec("DELETE FROM entries WHERE id='input'");
      if (change === "overwritten") database.exec("UPDATE entries SET r2_key='new' WHERE id='input'");
      if (change === "moved") database.exec("UPDATE entries SET path='/moved' WHERE id='input'");
      if (change === "live with expired pin") database.exec("UPDATE object_pins SET expires_at=1");
    };
    const { manifest } = await finishRun(auth, run.id);
    expect(manifest.inputs[0].path).toBe("/input");
    expect(pins()).toEqual([{ owner_id: "alice", reference_id: run.id, object_key: "input", expires_at: Date.parse(manifest.retainedUntil) }]);
  });
  it.each(["expired", "missing", "foreign owner", "foreign run", "foreign live entry"])("rejects unavailable inputs without creating output pins: %s", async (change) => {
    entry("input", "/input"); entry("output", "/out/file");
    const run = await start(["/input"]);
    let racedPins: ReturnType<typeof pins> = [];
    beforeBatch = () => {
      database.exec("DELETE FROM entries WHERE id='input'");
      if (change === "expired" || change === "foreign live entry") database.exec("UPDATE object_pins SET expires_at=1");
      if (change === "missing") database.exec("DELETE FROM object_pins");
      if (change === "foreign owner") database.exec("UPDATE object_pins SET owner_id='bob'");
      if (change === "foreign run") database.exec("UPDATE object_pins SET reference_id='other-run'");
      if (change === "foreign live entry") entry("foreign", "/input", "file", "bob", "input");
      racedPins = pins();
    };
    await expect(finishRun(auth, run.id)).rejects.toMatchObject({ status: 409 });
    unfinished(run.id);
    expect(pins()).toEqual(racedPins);
  });
  it("does not revive a pin that expires during R2 checks", async () => {
    const now = Date.now();
    const clock = vi.spyOn(Date, "now").mockReturnValue(now);
    entry("input", "/input"); entry("output", "/out/file");
    const run = await start(["/input"]);
    database.exec("DELETE FROM entries WHERE id='input'");
    database.prepare("UPDATE object_pins SET expires_at=?").run(now + 1000);
    state.head.mockImplementationOnce(async () => {
      clock.mockReturnValue(now + 2000);
      return { etag: "etag", checksums: {} };
    });
    await expect(finishRun(auth, run.id)).rejects.toMatchObject({ status: 409 });
    unfinished(run.id);
    expect(pins()[0].expires_at).toBe(now + 1000);
  });
  it("checks expiry using the database clock even if the bound timestamp is stale", async () => {
    entry("input", "/input");
    const run = await start(["/input"]), now = Date.now();
    database.exec("DELETE FROM entries WHERE id='input'");
    database.prepare("UPDATE object_pins SET expires_at=?").run(now - 1000);
    vi.spyOn(Date, "now").mockReturnValue(now - 60000);
    await expect(finishRun(auth, run.id)).rejects.toMatchObject({ status: 409 });
    unfinished(run.id);
    expect(pins()[0].expires_at).toBe(now - 1000);
  });
  it.each([null, { etag: "different", checksums: {} }])("rejects missing or changed R2 objects without any completion writes: %s", async (object) => {
    entry("output", "/out/file");
    const run = await start();
    state.head.mockResolvedValueOnce(object);
    calls = [];
    await expect(finishRun(auth, run.id)).rejects.toMatchObject({ status: 409 });
    unfinished(run.id);
    expect(calls).toHaveLength(2);
    expect(pins()).toEqual([]);
  });
  it("records checksum leading zeroes and null checksums, with timestamps taken after HEAD", async () => {
    entry("a", "/out/a"); entry("b", "/out/b");
    const run = await start(), completed = Date.now() + 60000;
    state.head.mockResolvedValueOnce({ etag: "etag", checksums: { sha256: new Uint8Array(32).map((_, i) => i).buffer } });
    state.head.mockImplementationOnce(async () => {
      vi.spyOn(Date, "now").mockReturnValue(completed);
      return { etag: "etag", checksums: {} };
    });
    const { manifest } = await finishRun(auth, run.id);
    expect(manifest.artifacts.map((output: any) => output.checksum)).toEqual(["000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f", null]);
    expect(Date.parse(manifest.completedAt)).toBe(completed);
    expect(Date.parse(manifest.retainedUntil)).toBe(completed + 7 * 86400000);
    expect(pins().every((pin) => pin.expires_at === Date.parse(manifest.retainedUntil))).toBe(true);
  });
  it("rejects 201 outputs before HEAD or writes", async () => {
    for (let i = 0; i < 201; i++) entry(`output-${i}`, `/out/file-${i}`);
    const run = await start();
    await expect(finishRun(auth, run.id)).rejects.toMatchObject({ status: 409 });
    unfinished(run.id);
    expect(state.head).not.toHaveBeenCalled();
    expect(pins()).toEqual([]);
  });
  it.each(["run_artifacts", "object_pins"])("rolls back completion and all writes when %s insertion fails", async (table) => {
    entry("input", "/input"); entry("a", "/out/a"); entry("b", "/out/b");
    const run = await start(["/input"]), originalPins = pins();
    const key = table === "object_pins" ? "object_key" : "path";
    const value = table === "object_pins" ? "b" : "/out/b";
    database.exec(`CREATE TRIGGER fail_completion BEFORE INSERT ON ${table} WHEN NEW.${key}='${value}' BEGIN SELECT RAISE(ABORT,'failed'); END`);
    await expect(finishRun(auth, run.id)).rejects.toThrow("failed");
    unfinished(run.id);
    expect(pins()).toEqual(originalPins);
    database.exec("DROP TRIGGER fail_completion");
    await finishRun(auth, run.id);
    expect(pins()).toHaveLength(3);
  });
  it("returns completed runs without HEAD, writes or extending retention, while still authorizing", async () => {
    entry("input", "/input"); entry("output", "/out/file");
    const run = await start(["/input"]), completed = await finishRun(auth, run.id), originalPins = pins();
    database.exec("DELETE FROM entries");
    calls = []; state.head.mockClear();
    expect(await finishRun(auth, run.id)).toEqual(completed);
    expect(calls).toHaveLength(1);
    expect(state.head).not.toHaveBeenCalled();
    expect(pins()).toEqual(originalPins);
    for (const requestAuth of [
      { ...auth, authSource: "api-token" as const, permissions: ["read" as const] },
      { ...auth, authSource: "api-token" as const, permissions: ["read" as const, "write" as const], pathPrefix: "/out" },
      { ...auth, authSource: "api-token" as const, permissions: ["read" as const, "write" as const], pathPrefix: "/elsewhere" },
    ]) await expect(finishRun(requestAuth, run.id)).rejects.toMatchObject({ status: 403 });
    await expect(finishRun({ ...auth, user: { id: "bob", email: "bob@example.test", name: "Bob" } }, run.id)).rejects.toMatchObject({ status: 404 });
    expect(pins()).toEqual(originalPins);
  });
  it.each([false, true])("returns a concurrent winner and retains only its keys, including equal public manifests: %s", async (identicalManifest) => {
    vi.spyOn(Date, "now").mockReturnValue(Date.now());
    entry("output", "/out/file", "file", "alice", "loser");
    const run = await start();
    let winner: Awaited<ReturnType<typeof finishRun>> | undefined;
    state.head.mockImplementationOnce(async () => {
      database.exec("UPDATE entries SET r2_key='winner' WHERE id='output'");
      if (!identicalManifest) database.exec("UPDATE entries SET path='/out/winner' WHERE id='output'");
      winner = await finishRun(auth, run.id);
      return { etag: "etag", checksums: { sha256: new Uint8Array(32).fill(0xab).buffer } };
    });
    expect(await finishRun(auth, run.id)).toEqual(winner);
    expect(database.prepare("SELECT object_key FROM run_artifacts WHERE kind='output'").all()).toEqual([{ object_key: "winner" }]);
    expect(pins()).toEqual([{ owner_id: "alice", reference_id: run.id, object_key: "winner", expires_at: Date.parse(winner!.manifest.retainedUntil) }]);
  });
  it("isolates output owners and literal scoped paths, while accepting an exact-root file", async () => {
    const scoped = { ...auth, authSource: "api-token" as const, pathPrefix: "/out%_", permissions: ["read" as const, "write" as const] };
    entry("exact", "/out%_"); entry("nested", "/out%_/文'file");
    entry("neighbor", "/out%_-other/file"); entry("wildcard", "/outXX/file"); entry("foreign", "/out%_/foreign", "file", "bob");
    const run = await createRun(scoped, { inputs: ["/out%_"], path: "/out%_", name: "Scoped", metadata: {} });
    beforeBatch = () => entry("foreign-race", "/out%_/new", "file", "bob");
    const { manifest } = await finishRun(scoped, run.id);
    expect(manifest.artifacts.map((output: any) => output.path)).toEqual(["/out%_", "/out%_/文'file"]);
    expect(pins().map((pin) => pin.object_key).sort()).toEqual(["exact", "nested"]);
  });
});

describe("bounded folder delete preflight", () => {
  it("does not materialize descendants for a recursive delete and retains all recovery rows", async () => {
    entry("folder", "/scope", "folder");
    for (let i = 0; i < 1000; i++) entry(`e${i}`, `/scope/f${i}`);
    entry("neighbor", "/scope-other/file"); entry("foreign", "/scope/file", "file", "bob");
    await deleteEntry("alice", "/scope", true);
    expect(roundTrips).toBe(2); // Root lookup and the existing retention/delete transaction.
    expect(calls.filter((c) => /^select /i.test(c.query))).toHaveLength(1);
    expect(calls.every((c) => !/RETURNING/i.test(c.query))).toBe(true);
    expect(database.prepare("SELECT count(*) AS n FROM recovery").get()!.n).toBe(1001);
    expect(database.prepare("SELECT id FROM entries ORDER BY id").all()).toEqual([{ id: "foreign" }, { id: "neighbor" }]);
  });
  it("uses a one-row probe for nonrecursive nonempty folders", async () => {
    entry("folder", "/scope", "folder"); entry("child", "/scope/child");
    await expect(deleteEntry("alice", "/scope")).rejects.toMatchObject({ status: 400 });
    expect(calls).toHaveLength(2);
    expect(calls[1].query).toMatch(/limit \?/i);
    expect(calls[1].params.at(-1)).toBe(1);
    expect(database.prepare("SELECT count(*) AS n FROM recovery").get()!.n).toBe(0);
  });
  it("the transaction still refuses a child introduced after the empty-folder probe", async () => {
    entry("folder", "/scope", "folder");
    beforeBatch = () => entry("child", "/scope/new-child");
    await expect(deleteEntry("alice", "/scope")).rejects.toMatchObject({ status: 409 });
    expect(database.prepare("SELECT count(*) AS n FROM entries").get()!.n).toBe(2);
    expect(database.prepare("SELECT count(*) AS n FROM recovery").get()!.n).toBe(0);
  });
});

describe("batched object collection", () => {
  function queued(key: string) {
    database.prepare("INSERT INTO object_gc VALUES(?,1)").run(key);
    database.prepare("INSERT INTO object_usage VALUES(?,'alice',NULL,10)").run(key);
  }
  it("deletes at most 100 unreferenced objects with one R2 call and one metadata transaction", async () => {
    for (let i = 0; i < 150; i++) queued(`key-${i}`);
    await collectGarbage();
    expect(state.remove).toHaveBeenCalledOnce();
    expect(state.remove.mock.calls[0][0]).toHaveLength(100);
    expect(roundTrips).toBe(2);
    expect(calls).toHaveLength(3);
    expect(database.prepare("SELECT count(*) AS n FROM object_gc").get()!.n).toBe(50);
    expect(database.prepare("SELECT count(*) AS n FROM object_usage").get()!.n).toBe(50);
  });
  it("excludes live, recovered, pinned, and in-flight objects", async () => {
    for (const key of ["live", "recovered", "pinned", "pending", "completing", "expired-pin", "free"]) queued(key);
    entry("live", "/live");
    database.exec(`INSERT INTO recovery(id,owner_id,group_id,reason,path,kind,r2_key,created_at,retained_at,expires_at) VALUES('r','alice','g','trash','/old','file','recovered',1,1,1);
      INSERT INTO object_pins VALUES('alice','run','pinned',9007199254740991),('alice','run','expired-pin',1);
      INSERT INTO uploads(id,owner_id,path,content_type,size,object_key,status,expires_at) VALUES('u','alice','/pending','text/plain',10,'pending','pending',9007199254740991),('c','alice','/completing','text/plain',10,'completing','completing',9007199254740991);`);
    await collectGarbage();
    expect(state.remove.mock.calls[0][0].sort()).toEqual(["expired-pin", "free"]);
    expect(database.prepare("SELECT count(*) AS n FROM object_gc").get()!.n).toBe(5);
  });
  it("keeps every retry record when R2 fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    queued("a"); queued("b");
    state.remove.mockRejectedValue(new Error("unavailable"));
    await collectGarbage();
    expect(roundTrips).toBe(1);
    expect(database.prepare("SELECT count(*) AS n FROM object_gc").get()!.n).toBe(2);
    expect(database.prepare("SELECT count(*) AS n FROM object_usage").get()!.n).toBe(2);
  });
  it("rolls back both metadata deletes after a database failure and retries safely", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    queued("a");
    database.exec("CREATE TRIGGER fail_gc BEFORE DELETE ON object_gc BEGIN SELECT RAISE(ABORT,'failed'); END");
    await collectGarbage();
    expect(database.prepare("SELECT count(*) AS n FROM object_usage").get()!.n).toBe(1);
    expect(database.prepare("SELECT count(*) AS n FROM object_gc").get()!.n).toBe(1);
    database.exec("DROP TRIGGER fail_gc");
    await collectGarbage();
    expect(state.remove).toHaveBeenCalledTimes(2);
    expect(database.prepare("SELECT count(*) AS n FROM object_gc").get()!.n).toBe(0);
  });
  it("does no writes or R2 calls for an empty queue", async () => {
    await collectGarbage();
    expect(roundTrips).toBe(1);
    expect(state.remove).not.toHaveBeenCalled();
  });
});

describe("durable queue send batching", () => {
  it("sends at most 50 messages and marks only that page after the send resolves", async () => {
    for (let i = 0; i < 60; i++) entry(`e${i}`, `/f${i}`);
    state.sendBatch.mockImplementation(async (messages) => {
      expect(messages).toHaveLength(50);
      expect(database.prepare("SELECT count(*) AS n FROM queue_outbox WHERE dispatched_at IS NOT NULL").get()!.n).toBe(0);
    });
    await dispatchBackground();
    expect(state.sendBatch).toHaveBeenCalledOnce();
    expect(roundTrips).toBe(4);
    expect(database.prepare("SELECT count(*) AS n FROM queue_outbox WHERE dispatched_at IS NOT NULL").get()!.n).toBe(50);
    expect(database.prepare("SELECT count(*) AS n FROM queue_outbox WHERE dispatched_at IS NULL").get()!.n).toBe(10);
  });
  it("retains all work for retry when delivery fails and sends nothing for an empty outbox", async () => {
    await dispatchBackground();
    expect(state.sendBatch).not.toHaveBeenCalled();
    entry("e", "/file");
    state.sendBatch.mockRejectedValue(new Error("queue unavailable"));
    await expect(dispatchBackground()).rejects.toThrow("queue unavailable");
    expect(database.prepare("SELECT dispatched_at FROM queue_outbox").get()!.dispatched_at).toBeNull();
    state.sendBatch.mockResolvedValue(undefined);
    await dispatchBackground();
    expect(database.prepare("SELECT dispatched_at FROM queue_outbox").get()!.dispatched_at).not.toBeNull();
  });
});

describe("quota usage owner index", () => {
  it("uses a covering owner seek and preserves physical-object deduplication and expiry", () => {
    entry("live", "/live"); entry("copy", "/copy", "file", "alice", "live");
    database.exec(`INSERT INTO recovery(id,owner_id,group_id,reason,path,kind,size,r2_key,created_at,retained_at,expires_at) VALUES('r','alice','g','trash','/old','file',10,'live',1,1,1);
      INSERT INTO object_usage VALUES('live','alice',NULL,10),('pinned','alice',NULL,20),('expired','alice',NULL,30),('other','bob',NULL,100);
      INSERT INTO object_pins VALUES('alice','r','live',9007199254740991),('alice','r','pinned',9007199254740991),('alice','r','expired',1),('bob','r','other',9007199254740991);`);
    const statement = sql`SELECT ${storageUsageSql("alice")} AS bytes`;
    expect(execute(statement)[0].bytes).toBe(30);
    const indexedPlan = execute(sql`EXPLAIN QUERY PLAN ${statement}`);
    expect(indexedPlan.some((row) => String(row.detail).includes("COVERING INDEX object_usage_owner_key_size_idx (owner_id=?)"))).toBe(true);
    database.exec("DROP INDEX object_usage_owner_key_size_idx");
    expect(execute(statement)[0].bytes).toBe(30);
    const oldPlan = execute(sql`EXPLAIN QUERY PLAN ${statement}`);
    expect(oldPlan.some((row) => row.detail === "SCAN u")).toBe(true);
  });
});
