import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ database: null as any, remove: vi.fn() }));
vi.mock("./bindings", () => ({
  requireResourceBindings: () => ({
    DB: {
      prepare: (query: string) => state.database.prepare(query),
      batch: (queries: unknown[]) => state.database.batch(queries),
    },
    FILES_BUCKET: { delete: state.remove },
  }),
}));
import { createSnapshot, restoreSnapshot } from "./snapshots";
import { collectGarbage } from "./garbage";
import type { RequestAuth } from "./authz";

let database: DatabaseSync;
let objects: Set<string>;
let beforeBatch: () => void | Promise<void>;
let beforeStatement: (index: number) => void;
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
  objects = new Set();
  beforeBatch = () => {};
  beforeStatement = () => {};
  state.remove.mockReset().mockImplementation(async (keys: string[]) => {
    for (const key of keys) objects.delete(key);
  });
  function prepare(query: string) {
    let params: SQLInputValue[] = [];
    const statement = {
      bind(...values: SQLInputValue[]) {
        if (values.length > 100) throw new Error("D1 supports at most 100 bound parameters");
        params = values;
        return statement;
      },
      execute() {
        const results = database.prepare(query).all(...params);
        return { results, success: true, meta: { changes: Number(database.prepare("SELECT changes() AS n").get()!.n) } };
      },
      async all() { return statement.execute(); },
      async run() { return statement.execute(); },
      async raw() { return statement.execute().results.map((row) => Object.values(row)); },
    };
    return statement;
  }
  state.database = {
    prepare,
    async batch(queries: ReturnType<typeof prepare>[]) {
      // Consume the hook so a GC batch can run before the restore transaction.
      const hook = beforeBatch;
      beforeBatch = () => {};
      await hook();
      database.exec("BEGIN");
      try {
        const results = queries.map((query, index) => {
          beforeStatement(index);
          return query.execute();
        });
        database.exec("COMMIT");
        return results;
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

function entry(id: string, path: string, owner = "alice", kind = "file") {
  database.prepare(`INSERT INTO entries(id,owner_id,path,parent_path,name,kind,size,r2_key,etag,content_type)
    VALUES(?,?,?,?,?,?,10,?,'etag','text/plain')`).run(
    id, owner, path, path.slice(0, path.lastIndexOf("/")) || "/", path.split("/").at(-1)!, kind,
    kind === "file" ? id : null,
  );
  if (kind === "file") {
    objects.add(id);
    database.prepare("INSERT INTO object_usage VALUES(?,?,NULL,10)").run(id, owner);
  }
}

async function fixture(requestAuth = auth, path = "/scope") {
  const owner = requestAuth.user.id;
  entry("folder", path, owner, "folder");
  entry("old-a", `${path}/a`, owner);
  entry("old-b", `${path}/b`, owner);
  const snapshot = await createSnapshot(requestAuth, { name: "Before", path, days: 1 });
  // The snapshot pins are the only remaining references to the old objects.
  database.exec("DELETE FROM entries WHERE id IN ('old-a','old-b')");
  entry("current-a", `${path}/a`, owner);
  entry("current-b", `${path}/b`, owner);
  entry("current-extra", `${path}/extra`, owner);
  database.exec("INSERT INTO object_gc VALUES('old-a',1),('old-b',1)");
  return snapshot;
}

function persistedState() {
  return Object.fromEntries([
    "entries", "recovery", "snapshots", "snapshot_entries", "object_pins",
    "change_log", "share_links", "index_jobs", "index_job_status", "object_usage", "object_gc",
  ].map((table) => [table, database.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()]));
}

function expireAt(id: string, at: number) {
  database.prepare("UPDATE snapshots SET expires_at=? WHERE id=?").run(at, id);
  database.prepare("UPDATE object_pins SET expires_at=? WHERE reference_id=?").run(at, id);
}

function databaseClock(at: number) {
  const clock = { now: at };
  database.function("julianday", (_value: SQLInputValue) => clock.now / 86400000 + 2440587.5);
  database.function("unixepoch", () => Math.floor(clock.now / 1000));
  return clock;
}

function expectRestored(owner = "alice", path = "/scope") {
  expect(database.prepare("SELECT path,r2_key FROM entries WHERE owner_id=? ORDER BY path").all(owner)).toEqual([
    { path, r2_key: null },
    { path: `${path}/a`, r2_key: "old-a" },
    { path: `${path}/b`, r2_key: "old-b" },
  ]);
  expect(database.prepare("SELECT path,r2_key,reason FROM recovery WHERE owner_id=? ORDER BY path").all(owner)).toEqual([
    { path, r2_key: null, reason: "trash" },
    { path: `${path}/a`, r2_key: "current-a", reason: "trash" },
    { path: `${path}/b`, r2_key: "current-b", reason: "trash" },
    { path: `${path}/extra`, r2_key: "current-extra", reason: "trash" },
  ]);
}

describe("snapshot restore transaction safety", () => {
  it("rejects a stale request clock after snapshot expiry and actual GC without changing retained or live data", async () => {
    const snapshot = await fixture();
    const now = Date.now();
    expireAt(snapshot.id, now - 2000);
    vi.spyOn(Date, "now").mockReturnValue(now - 60000);
    let afterGc: ReturnType<typeof persistedState> | undefined;
    beforeBatch = async () => {
      await collectGarbage();
      expect(state.remove).toHaveBeenCalledWith(["old-a", "old-b"]);
      expect(objects.has("old-a")).toBe(false);
      expect(objects.has("old-b")).toBe(false);
      afterGc = persistedState();
    };
    await expect(restoreSnapshot(auth, snapshot.id)).rejects.toMatchObject({ status: 409 });
    expect(afterGc).toBeDefined();
    expect(persistedState()).toEqual(afterGc);
  });

  it("rejects expiry while the batch waits to execute with a frozen request clock", async () => {
    const now = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(now);
    const clock = databaseClock(now);
    const snapshot = await fixture();
    expireAt(snapshot.id, now + 1000);
    beforeBatch = () => { clock.now = now + 1000; };
    const before = persistedState();
    await expect(restoreSnapshot(auth, snapshot.id)).rejects.toMatchObject({ status: 409 });
    expect(persistedState()).toEqual(before);
  });

  it.each([1, 2, 3])("uses one eligibility decision when expiry passes before batch statement %i", async (index) => {
    const now = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(now);
    const clock = databaseClock(now);
    const snapshot = await fixture();
    expireAt(snapshot.id, now + 1000);
    const before = persistedState();
    beforeStatement = (current) => {
      if (current === index) clock.now = now + 2000;
    };
    await expect(restoreSnapshot(auth, snapshot.id)).resolves.toEqual({ ok: true, restored: 3 });
    expectRestored();
    for (const table of ["snapshots", "snapshot_entries", "object_pins"])
      expect(persistedState()[table]).toEqual(before[table]);
    // Expired pins no longer protect the objects, but the restored entries do.
    await collectGarbage();
    expect(state.remove).not.toHaveBeenCalled();
    expect(objects.has("old-a")).toBe(true);
    expect(objects.has("old-b")).toBe(true);
  });

  it("restores normally, retains every overwritten entry, and isolates owners and literal prefixes", async () => {
    const snapshot = await fixture(auth, "/scope%_");
    entry("neighbor", "/scope%_-neighbor");
    entry("foreign", "/scope%_/a", "bob");
    const before = persistedState();
    await expect(restoreSnapshot(auth, snapshot.id)).resolves.toEqual({ ok: true, restored: 3 });
    const after = persistedState();
    for (const id of ["neighbor", "foreign"])
      expect(after.entries.find((row) => row.id === id)).toEqual(before.entries.find((row) => row.id === id));
    expect(database.prepare("SELECT path,r2_key FROM entries WHERE owner_id='alice' AND path!='/scope%_-neighbor' ORDER BY path").all()).toEqual([
      { path: "/scope%_", r2_key: null },
      { path: "/scope%_/a", r2_key: "old-a" },
      { path: "/scope%_/b", r2_key: "old-b" },
    ]);
    expect(after.recovery).toHaveLength(4);
    expect(new Set(after.recovery.map((row) => row.group_id)).size).toBe(1);
    expect(after.recovery.every((row) => row.owner_id === "alice" && row.reason === "trash")).toBe(true);
    for (const table of ["snapshots", "snapshot_entries", "object_pins"])
      expect(after[table]).toEqual(before[table]);
  });

  it("restores into an empty destination without relying on retention row counts", async () => {
    const snapshot = await fixture();
    database.exec("DELETE FROM entries");
    await expect(restoreSnapshot(auth, snapshot.id)).resolves.toEqual({ ok: true, restored: 3 });
    expect(database.prepare("SELECT count(*) AS n FROM recovery").get()!.n).toBe(0);
    expect(database.prepare("SELECT path FROM entries ORDER BY path").all()).toEqual([
      { path: "/scope" }, { path: "/scope/a" }, { path: "/scope/b" },
    ]);
  });

  it("restores an empty snapshot by retaining and removing the current subtree", async () => {
    const snapshot = await createSnapshot(auth, { name: "Empty", path: "/scope", days: 1 });
    entry("current", "/scope");
    await expect(restoreSnapshot(auth, snapshot.id)).resolves.toEqual({ ok: true, restored: 0 });
    expect(database.prepare("SELECT * FROM entries").all()).toEqual([]);
    expect(database.prepare("SELECT r2_key FROM recovery").all()).toEqual([{ r2_key: "current" }]);
    expect(database.prepare("SELECT id FROM snapshots").all()).toEqual([{ id: snapshot.id }]);
  });

  it.each(["deleted", "expired", "owner changed"])("rejects a snapshot race before the batch: %s", async (race) => {
    const snapshot = await fixture();
    let raced: ReturnType<typeof persistedState> | undefined;
    beforeBatch = () => {
      if (race === "deleted") database.prepare("DELETE FROM snapshots WHERE id=?").run(snapshot.id);
      if (race === "expired") expireAt(snapshot.id, 1);
      if (race === "owner changed") database.prepare("UPDATE snapshots SET owner_id='bob' WHERE id=?").run(snapshot.id);
      raced = persistedState();
    };
    await expect(restoreSnapshot(auth, snapshot.id)).rejects.toMatchObject({ status: 409 });
    expect(persistedState()).toEqual(raced);
  });

  it.each(["deleted", "file", "foreign owner"])("rejects an unavailable parent at transaction time: %s", async (race) => {
    entry("parent", "/parent", "alice", "folder");
    const snapshot = await fixture(auth, "/parent/scope");
    let raced: ReturnType<typeof persistedState> | undefined;
    beforeBatch = () => {
      if (race === "deleted") database.exec("DELETE FROM entries WHERE id='parent'");
      if (race === "file") database.exec("UPDATE entries SET kind='file' WHERE id='parent'");
      if (race === "foreign owner") database.exec("UPDATE entries SET owner_id='bob' WHERE id='parent'");
      raced = persistedState();
    };
    await expect(restoreSnapshot(auth, snapshot.id)).rejects.toMatchObject({ status: 409 });
    expect(persistedState()).toEqual(raced);
  });

  it.each(["paused", "removed member", "viewer", "over quota"])("rechecks workspace policy at transaction time: %s", async (race) => {
    database.exec(`INSERT INTO user(id,email) VALUES('ws_team','ws_team@example.test');
      INSERT INTO workspaces(id,name,created_by,created_at) VALUES('ws_team','Team','alice',1);
      INSERT INTO workspace_members VALUES('ws_team','alice','owner',1);`);
    const workspaceAuth: RequestAuth = {
      ...auth, user: { ...auth.user, id: "ws_team" }, actor: auth.user,
      workspaceId: "ws_team", workspaceRole: "owner",
    };
    const snapshot = await fixture(workspaceAuth);
    beforeBatch = () => {
      if (race === "paused") database.exec("UPDATE workspaces SET paused=1");
      if (race === "removed member") database.exec("DELETE FROM workspace_members");
      if (race === "viewer") database.exec("UPDATE workspace_members SET role='viewer'");
      if (race === "over quota") database.exec("UPDATE workspaces SET storage_limit=1");
    };
    const before = persistedState();
    await expect(restoreSnapshot(workspaceAuth, snapshot.id)).rejects.toMatchObject({ status: 409 });
    expect(persistedState()).toEqual(before);
  });

  it("preserves session, permission, path and owner authorization", async () => {
    const snapshot = await fixture();
    const before = persistedState();
    for (const requestAuth of [
      { ...auth, authSource: "api-token" as const, permissions: ["manage", "write", "delete"] as const },
      { ...auth, permissions: ["write", "delete"] as const },
      { ...auth, permissions: ["manage", "delete"] as const },
      { ...auth, permissions: ["manage", "write"] as const },
      { ...auth, pathPrefix: "/elsewhere" },
      { ...auth, workspacePaused: true },
    ]) {
      await expect(restoreSnapshot({ ...requestAuth, permissions: requestAuth.permissions ? [...requestAuth.permissions] : undefined }, snapshot.id))
        .rejects.toMatchObject({ status: 403 });
    }
    await expect(restoreSnapshot({ ...auth, user: { ...auth.user, id: "bob" } }, snapshot.id))
      .rejects.toMatchObject({ status: 404 });
    expect(persistedState()).toEqual(before);
  });

  it.each(["recovery", "entries"])("rolls back all changes if insertion into %s fails", async (table) => {
    const snapshot = await fixture();
    database.exec(`CREATE TRIGGER fail_restore BEFORE INSERT ON ${table}
      WHEN NEW.path='/scope/b' BEGIN SELECT RAISE(ABORT,'restore failed'); END`);
    const before = persistedState();
    await expect(restoreSnapshot(auth, snapshot.id)).rejects.toThrow("restore failed");
    expect(persistedState()).toEqual(before);
  });
});
