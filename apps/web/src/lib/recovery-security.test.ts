import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RequestAuth } from "./authz";

const state = vi.hoisted(() => ({
  database: null as ReturnType<typeof createDatabase> | null,
}));
vi.mock("./bindings", () => ({
  requireResourceBindings: () => ({
    DB: {
      prepare: (query: string) => state.database!.prepare(query),
      batch: (queries: Parameters<ReturnType<typeof createDatabase>["batch"]>[0]) =>
        state.database!.batch(queries),
    },
  }),
}));
import { restoreRecovery } from "./recovery";

let database: DatabaseSync;
let batchSizes: number[];
let afterRead: ReturnType<typeof vi.fn<() => void>>;
let beforeBatch: ReturnType<typeof vi.fn<() => void>>;
const auth: RequestAuth = {
  authSource: "api-token",
  user: { id: "alice", email: "alice@example.test", name: "Alice" },
  pathPrefix: "/scope",
  permissions: ["read", "write"],
};

// Exercise the real Drizzle queries, folder-chain SQL and atomic restore batch.
// The read hook changes SQLite after taking the first lookup's snapshot.
function createDatabase() {
  function prepare(query: string) {
    let params: SQLInputValue[] = [];
    const statement = {
      bind(...values: SQLInputValue[]) {
        if (values.length > 100)
          throw new Error("D1 supports at most 100 bound parameters");
        params = values;
        return statement;
      },
      execute() {
        const results = database.prepare(query).all(...params);
        return {
          results,
          success: true,
          meta: {
            changes: Number(database.prepare("SELECT changes() AS n").get()!.n),
          },
        };
      },
      async all() {
        const result = statement.execute();
        afterRead();
        return result;
      },
      async raw() {
        return (await statement.all()).results.map((row) => Object.values(row));
      },
    };
    return statement;
  }
  return {
    prepare,
    async batch(queries: ReturnType<typeof prepare>[]) {
      batchSizes.push(queries.length);
      beforeBatch();
      database.exec("BEGIN");
      try {
        const results = queries.map((query) => query.execute());
        database.exec("COMMIT");
        return results;
      } catch (error) {
        database.exec("ROLLBACK");
        throw error;
      }
    },
  };
}

beforeEach(() => {
  database = new DatabaseSync(":memory:");
  database.exec("PRAGMA foreign_keys=ON");
  const migrations = new URL(
    "../../../../packages/db/src/migrations/",
    import.meta.url,
  );
  for (const file of readdirSync(migrations).filter((f) => f.endsWith(".sql")).sort())
    database.exec(readFileSync(new URL(file, migrations), "utf8"));
  database.exec(
    "INSERT INTO user(id,email) VALUES('alice','alice@example.test'),('bob','bob@example.test')",
  );
  batchSizes = [];
  afterRead = vi.fn();
  beforeBatch = vi.fn();
  state.database = createDatabase();
});
afterEach(() => {
  database.close();
  vi.restoreAllMocks();
});

function retained(
  id: string,
  path: string,
  kind: "folder" | "file" = "file",
  { owner = "alice", group = "group", reason = "trash", expiresAt = Date.now() + 86_400_000 } = {},
) {
  database.prepare(`INSERT INTO recovery
    (id,owner_id,group_id,reason,path,kind,size,content_type,etag,r2_key,created_at,retained_at,expires_at)
    VALUES(?,?,?,?,?,?,10,'text/plain','etag',?,1234,?,?)`)
    .run(id, owner, group, reason, path, kind, kind === "file" ? `object-${id}` : null, Date.now(), expiresAt);
}
function seedFolder() {
  retained("folder", "/scope/deleted", "folder");
  retained("file", "/scope/deleted/file.txt");
}
function expectNoDestinationWrites() {
  expect(database.prepare("SELECT path FROM entries ORDER BY path").all()).toEqual([]);
  expect(database.prepare("SELECT * FROM change_log").all()).toEqual([]);
  expect(batchSizes).toEqual([]);
}
function seedCurrentEntries() {
  database.exec(`INSERT INTO entries
    (id,owner_id,path,parent_path,name,kind,size,r2_key,etag,created_at,updated_at)
    VALUES ('scope','alice','/scope','/','scope','folder',NULL,NULL,NULL,1,1),
      ('current','alice','/scope/current.txt','/scope','current.txt','file',20,'current-object','current-etag',2,3)`);
}
const liveEntries = () => database.prepare("SELECT * FROM entries ORDER BY id").all();
const retainedRows = () => database.prepare("SELECT * FROM recovery ORDER BY id").all();
const changes = () => database.prepare("SELECT * FROM change_log ORDER BY seq").all();
const restoreState = () => ({ entries: liveEntries(), recovery: retainedRows(), changes: changes() });

describe("recovery destination authorization", () => {
  const forbidden: Array<{
    name: string;
    permissions: RequestAuth["permissions"];
    target: string;
  }> = [
    { name: "read/delete token outside its scope", permissions: ["read", "delete"], target: "/outside/created/restored" },
    { name: "writable token outside its scope", permissions: ["read", "write", "delete"], target: "/outside/created/restored" },
    { name: "read/delete token inside its scope", permissions: ["read", "delete"], target: "/scope/created/restored" },
  ];
  describe.each([false, true])("group disappears after the first lookup: %s", (disappears) => {
    it.each(forbidden)("rejects a $name before creating ancestors", async ({ permissions, target }) => {
      seedFolder();
      if (disappears)
        afterRead.mockImplementationOnce(() => database.exec("DELETE FROM recovery"));

      const error = await restoreRecovery({ ...auth, permissions }, "folder", target).catch((error) => error);

      expectNoDestinationWrites();
      expect(error).toMatchObject({ status: 403 });
      expect(database.prepare("SELECT id FROM recovery").all()).toHaveLength(disappears ? 0 : 2);
    });
  });

  it.each(["purged", "expired", "only unrelated group rows remain"])(
    "returns 404 without creating ancestors when the authorized selection is empty: %s",
    async (change) => {
      seedFolder();
      if (change === "only unrelated group rows remain")
        retained("neighbor", "/scope/deleted-neighbor");
      afterRead.mockImplementationOnce(() => database.exec(
        change === "expired"
          ? "UPDATE recovery SET expires_at=1"
          : "DELETE FROM recovery WHERE id IN ('folder','file')",
      ));

      const error = await restoreRecovery(auth, "folder", "/scope/created/restored").catch((error) => error);

      expectNoDestinationWrites();
      expect(error).toMatchObject({ status: 404 });
      expect(afterRead).toHaveBeenCalledTimes(2);
    },
  );

  it.each(["folder", "file"] as const)("still requires read access to a retained %s", async (kind) => {
    retained("item", "/scope/deleted", kind);
    await expect(restoreRecovery({ ...auth, permissions: ["write", "delete"] }, "item", "/scope/created/restored"))
      .rejects.toMatchObject({ status: 403 });
    expectNoDestinationWrites();
  });
});

describe("recovery restore invariants", () => {
  it("restores a deep subtree parent-first in one transaction, preserving metadata and unrelated recovery rows", async () => {
    // Recovery lookup order need not put parents before their descendants.
    retained("file", "/scope/deleted/branch/deep/file.txt");
    retained("deep", "/scope/deleted/branch/deep", "folder");
    retained("branch", "/scope/deleted/branch", "folder");
    retained("folder", "/scope/deleted", "folder");
    retained("expired", "/scope/deleted/expired.txt", "file", { expiresAt: 1 });
    retained("neighbor", "/scope/deleted-neighbor");
    retained("other-group", "/scope/deleted/other.txt", "file", { group: "other" });
    retained("foreign", "/scope/deleted/foreign.txt", "file", { owner: "bob" });
    const untouched = database.prepare("SELECT * FROM recovery WHERE id NOT IN ('folder','branch','deep','file') ORDER BY id").all();
    const target = `/scope${"/nested".repeat(20)}/restored`;

    await expect(restoreRecovery(auth, "folder", target)).resolves.toEqual({ path: target, count: 4 });

    expect(batchSizes).toEqual([10]);
    expect(database.prepare("SELECT count(*) AS n FROM entries").get()!.n).toBe(25);
    expect(database.prepare("SELECT kind FROM entries WHERE path=?").get(target)).toEqual({ kind: "folder" });
    expect(database.prepare("SELECT owner_id,parent_path,name,kind,size,content_type,etag,r2_key,created_at FROM entries WHERE path=?").get(`${target}/branch/deep/file.txt`))
      .toEqual({ owner_id: "alice", parent_path: `${target}/branch/deep`, name: "file.txt", kind: "file", size: 10, content_type: "text/plain", etag: "etag", r2_key: "object-file", created_at: 1234 });
    expect(database.prepare(`SELECT e.path FROM entries e WHERE e.parent_path!='/'
      AND NOT EXISTS(SELECT 1 FROM entries p WHERE p.owner_id=e.owner_id AND p.path=e.parent_path AND p.kind='folder')`).all()).toEqual([]);
    expect(database.prepare("SELECT * FROM recovery ORDER BY id").all()).toEqual(untouched);
  });

  it.each(["trash", "version"])("restores a retained %s file to its original path", async (reason) => {
    retained("file", "/scope/original.txt", "file", { reason });
    retained("other", "/scope/other.txt", "file", { reason });
    await expect(restoreRecovery(auth, "file")).resolves.toEqual({ path: "/scope/original.txt", count: 1 });
    expect(database.prepare("SELECT path,r2_key FROM entries WHERE kind='file'").all()).toEqual([{ path: "/scope/original.txt", r2_key: "object-file" }]);
    expect(database.prepare("SELECT id FROM recovery").all()).toEqual([{ id: "other" }]);
    expect(batchSizes).toEqual([4]);
  });

  it.each(["missing", "expired", "foreign"])("rejects an initially %s item without creating ancestors", async (condition) => {
    if (condition !== "missing")
      retained("item", "/scope/deleted", "folder", condition === "expired" ? { expiresAt: 1 } : { owner: "bob" });
    await expect(restoreRecovery(auth, "item", "/scope/created/restored")).rejects.toMatchObject({ status: 404 });
    expectNoDestinationWrites();
  });

  it.each(["purged", "expired", "foreign"])("rolls back ancestors and restores if a selected child becomes %s", async (change) => {
    seedCurrentEntries();
    seedFolder();
    let beforeRestore = restoreState();
    beforeBatch.mockImplementationOnce(() => {
      database.exec(change === "purged"
        ? "DELETE FROM recovery WHERE id='file'"
        : change === "expired"
          ? "UPDATE recovery SET expires_at=1 WHERE id='file'"
          : "UPDATE recovery SET owner_id='bob' WHERE id='file'");
      beforeRestore = restoreState();
    });
    await expect(restoreRecovery(auth, "folder", "/scope/new/restored")).rejects.toMatchObject({ status: 409 });
    expect(restoreState()).toEqual(beforeRestore);
    expect(batchSizes).toEqual([6]);
  });
});

describe("recovery ancestor atomicity", () => {
  it("recreates a parent deleted before the batch and cannot consume recovery with a missing parent", async () => {
    seedCurrentEntries();
    seedFolder();
    database.exec(`INSERT INTO entries(id,owner_id,path,parent_path,name,kind)
      VALUES('parent','alice','/scope/new','/scope','new','folder')`);
    const current = database.prepare("SELECT * FROM entries WHERE id='current'").get();
    // With separate batches this also deletes the parent between ancestor
    // creation and restoration, exposing the old successful orphan restore.
    beforeBatch.mockImplementation(() => database.exec("DELETE FROM entries WHERE path='/scope/new'"));

    await expect(restoreRecovery(auth, "folder", "/scope/new/restored"))
      .resolves.toEqual({ path: "/scope/new/restored", count: 2 });

    expect(database.prepare("SELECT kind FROM entries WHERE path='/scope/new'").get()).toEqual({ kind: "folder" });
    expect(database.prepare("SELECT path,parent_path FROM entries WHERE path LIKE '/scope/new/%' ORDER BY path").all())
      .toEqual([
        { path: "/scope/new/restored", parent_path: "/scope/new" },
        { path: "/scope/new/restored/file.txt", parent_path: "/scope/new/restored" },
      ]);
    expect(database.prepare("SELECT * FROM entries WHERE id='current'").get()).toEqual(current);
    expect(retainedRows()).toEqual([]);
    expect(beforeBatch).toHaveBeenCalledOnce();
  });

  it("rejects a parent replaced by a file before the batch without changing live or retained data", async () => {
    seedCurrentEntries();
    seedFolder();
    database.exec(`INSERT INTO entries(id,owner_id,path,parent_path,name,kind)
      VALUES('parent','alice','/scope/new','/scope','new','folder')`);
    let beforeRestore = restoreState();
    beforeBatch.mockImplementationOnce(() => {
      database.exec("DELETE FROM entries WHERE id='parent'");
      database.exec(`INSERT INTO entries(id,owner_id,path,parent_path,name,kind,r2_key)
        VALUES('replacement','alice','/scope/new','/scope','new','file','replacement-object')`);
      beforeRestore = restoreState();
    });

    await expect(restoreRecovery(auth, "folder", "/scope/new/restored")).rejects.toMatchObject({ status: 409 });

    expect(restoreState()).toEqual(beforeRestore);
  });

  it("rejects a deep ancestor conflict even when the immediate parent is already a folder", async () => {
    seedCurrentEntries();
    seedFolder();
    database.exec(`INSERT INTO entries(id,owner_id,path,parent_path,name,kind,r2_key)
      VALUES('blocker','alice','/scope/new/blocked','/scope/new','blocked','file','blocker-object'),
        ('parent','alice','/scope/new/blocked/deeper','/scope/new/blocked','deeper','folder',NULL)`);
    const beforeRestore = restoreState();

    await expect(restoreRecovery(auth, "folder", "/scope/new/blocked/deeper/restored"))
      .rejects.toMatchObject({ status: 409 });

    expect(restoreState()).toEqual(beforeRestore);
  });

  it.each(["missing", "file"])("rolls back ancestors and all selected rows when a subtree parent is %s", async (parent) => {
    seedCurrentEntries();
    retained("folder", "/scope/deleted", "folder");
    if (parent === "file") retained("parent", "/scope/deleted/branch");
    retained("child", "/scope/deleted/branch/child.txt");
    const beforeRestore = restoreState();

    await expect(restoreRecovery(auth, "folder", "/scope/new/restored"))
      .rejects.toMatchObject({ status: 409 });

    expect(restoreState()).toEqual(beforeRestore);
  });

  it.each(["deleted", "replaced"])("rolls back the complete transaction if a restored parent is %s before its child INSERT", async (change) => {
    seedCurrentEntries();
    seedFolder();
    const beforeRestore = restoreState();
    database.exec(`CREATE TRIGGER invalidate_restored_parent AFTER DELETE ON recovery WHEN OLD.id='folder'
      BEGIN ${change === "deleted"
        ? "DELETE FROM entries WHERE path='/scope/new/restored'"
        : "UPDATE entries SET kind='file',r2_key='replacement' WHERE path='/scope/new/restored'"}; END`);

    await expect(restoreRecovery(auth, "folder", "/scope/new/restored"))
      .rejects.toMatchObject({ status: 409 });

    expect(restoreState()).toEqual(beforeRestore);
  });

  it("rolls back new ancestors on a destination conflict without overwriting the existing entry", async () => {
    seedCurrentEntries();
    seedFolder();
    database.exec(`INSERT INTO entries(id,owner_id,path,parent_path,name,kind,r2_key)
      VALUES('existing','alice','/scope/new/restored','/scope/new','restored','file','existing-object')`);
    const beforeRestore = restoreState();

    await expect(restoreRecovery(auth, "folder", "/scope/new/restored"))
      .rejects.toMatchObject({ status: 409 });

    expect(restoreState()).toEqual(beforeRestore);
  });

  it("supports restoring directly under the implicit root", async () => {
    retained("file", "/scope/deleted.txt");
    await expect(restoreRecovery({ ...auth, pathPrefix: "/" }, "file", "/restored.txt"))
      .resolves.toEqual({ path: "/restored.txt", count: 1 });
    expect(database.prepare("SELECT path,parent_path,r2_key FROM entries").all())
      .toEqual([{ path: "/restored.txt", parent_path: "/", r2_key: "object-file" }]);
    expect(retainedRows()).toEqual([]);
  });
});

describe("recovery expiry at database execution time", () => {
  it.each(["trash", "version"])(
    "rejects a %s file that expires while its batch waits, despite an old request clock",
    async (reason) => {
      const at = Date.now();
      seedCurrentEntries();
      retained("file", "/scope/current.txt", "file", { reason, expiresAt: at + 60_000 });
      const originalEntries = liveEntries();
      const originalChanges = changes();
      vi.spyOn(Date, "now").mockReturnValue(at - 60_000);
      let expiredRows = retainedRows();
      beforeBatch.mockImplementationOnce(() => {
        // The row was live during selection; it is now expired in SQLite but
        // still newer than the request timestamp already bound to the INSERT.
        database.prepare("UPDATE recovery SET expires_at=? WHERE id='file'").run(at - 1_000);
        expiredRows = retainedRows();
      });

      await expect(restoreRecovery(auth, "file", "/scope/new/restored.txt"))
        .rejects.toMatchObject({ status: 409 });

      expect(beforeBatch).toHaveBeenCalledOnce();
      expect(liveEntries()).toEqual(originalEntries);
      expect(changes()).toEqual(originalChanges);
      expect(retainedRows()).toEqual(expiredRows);
    },
  );

  it("rolls back earlier inserts and recovery deletions when a later row expires mid-batch", async () => {
    const at = Date.now();
    const expiresAt = Math.floor(at / 1_000) * 1_000 + 60_123;
    seedCurrentEntries();
    retained("folder", "/scope/deleted", "folder", { expiresAt });
    retained("file", "/scope/deleted/file.txt", "file", { expiresAt });
    retained("other", "/scope/deleted/other.txt", "file", { expiresAt });
    const originalEntries = liveEntries();
    const originalRecovery = retainedRows();
    const originalChanges = changes();
    vi.spyOn(Date, "now").mockReturnValue(at - 60_000);

    // Advance only SQLite's clock after the first INSERT/DELETE pair. The
    // expired rows themselves remain unchanged, as with elapsed execution time.
    let databaseAt = at;
    database.function("julianday", (value) => {
      expect(value).toBe("now");
      return databaseAt / 86_400_000 + 2440587.5;
    });
    let firstProgress: { entries: number; recovery: number } | undefined;
    const advanceClock = vi.fn(() => {
      firstProgress ??= { entries: liveEntries().length, recovery: retainedRows().length };
      databaseAt = expiresAt;
      return null;
    });
    database.function("advance_recovery_clock", advanceClock);
    database.exec(`CREATE TRIGGER recovery_batch_clock AFTER DELETE ON recovery
      BEGIN SELECT advance_recovery_clock(); END`);

    await expect(restoreRecovery(auth, "folder", "/scope/new/restored"))
      .rejects.toMatchObject({ status: 409 });

    expect(advanceClock).toHaveBeenCalledOnce();
    expect(firstProgress).toEqual({ entries: originalEntries.length + 2, recovery: originalRecovery.length - 1 });
    expect(liveEntries()).toEqual(originalEntries);
    expect(changes()).toEqual(originalChanges);
    expect(retainedRows()).toEqual(originalRecovery);
    expect(batchSizes).toEqual([8]);
  });

  it("keeps the request time as a lower bound when it is ahead of SQLite's clock", async () => {
    const at = Date.now();
    seedCurrentEntries();
    retained("file", "/scope/current.txt", "file", { expiresAt: at + 60_000 });
    const originalEntries = liveEntries();
    const originalRecovery = retainedRows();
    vi.spyOn(Date, "now").mockReturnValue(at + 120_000);

    await expect(restoreRecovery(auth, "file", "/scope/restored.txt"))
      .rejects.toMatchObject({ status: 409 });

    expect(liveEntries()).toEqual(originalEntries);
    expect(retainedRows()).toEqual(originalRecovery);
  });

  it("restores an unexpired version with an old request clock without changing the current file", async () => {
    const at = Date.now();
    seedCurrentEntries();
    retained("file", "/scope/current.txt", "file", { reason: "version", expiresAt: at + 60_000 });
    const current = database.prepare("SELECT * FROM entries WHERE id='current'").get();
    vi.spyOn(Date, "now").mockReturnValue(at - 60_000);

    await expect(restoreRecovery(auth, "file", "/scope/restored.txt"))
      .resolves.toEqual({ path: "/scope/restored.txt", count: 1 });

    expect(database.prepare("SELECT * FROM entries WHERE id='current'").get()).toEqual(current);
    expect(database.prepare("SELECT r2_key,size,etag FROM entries WHERE path='/scope/restored.txt'").get())
      .toEqual({ r2_key: "object-file", size: 10, etag: "etag" });
    expect(retainedRows()).toEqual([]);
    expect(batchSizes).toEqual([4]);
  });
});
