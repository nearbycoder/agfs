import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  database: null as any,
  beforeBatch: () => {},
}));
vi.mock("./bindings", () => ({
  requireResourceBindings: () => ({ DB: mocks.database }),
}));
vi.mock("./account", () => ({
  getAccountSummaryForUser: async () => ({ storageLimitBytes: 1_000_000 }),
}));
import { acceptTransfer, proposeTransfer } from "./workspace-admin";
import { updateMember } from "./workspaces";
import type { RequestAuth } from "./authz";
let database: DatabaseSync;
const owner: RequestAuth = {
  authSource: "session",
  user: { id: "ws_team", email: "alice@example.test", name: "Team" },
  actor: { id: "alice", email: "alice@example.test", name: "Alice" },
  workspaceId: "ws_team",
  workspaceRole: "owner",
};
const recipient: RequestAuth = {
  ...owner,
  actor: { id: "bob", email: "bob@example.test", name: "Bob" },
  workspaceRole: "editor",
};
beforeEach(() => {
  database = new DatabaseSync(":memory:");
  database.exec("PRAGMA foreign_keys=ON");
  const dir = new URL(
    "../../../../packages/db/src/migrations/",
    import.meta.url,
  );
  for (const file of readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort())
    database.exec(readFileSync(new URL(file, dir), "utf8"));
  database.exec(`INSERT INTO user(id,email) VALUES ('alice','alice@example.test'),('bob','bob@example.test'),('ws_team','ws_team@example.test');
    INSERT INTO workspaces(id,name,created_by,created_at) VALUES ('ws_team','Team','alice',1);
    INSERT INTO workspace_members VALUES ('ws_team','alice','owner',1),('ws_team','bob','editor',1);`);
  database
    .prepare(
      "INSERT INTO ownership_transfers VALUES ('ws_team','alice','bob',?)",
    )
    .run(Date.now() + 86400000);
  mocks.beforeBatch = () => {};
  mocks.database = {
    prepare: (sql: string) => ({
      bind: (...params: SQLInputValue[]) => ({
        all: async () => ({ results: database.prepare(sql).all(...params) }),
        sql,
        params,
      }),
    }),
    batch: async (queries: Array<{ sql: string; params: SQLInputValue[] }>) => {
      mocks.beforeBatch();
      database.exec("BEGIN");
      try {
        const results = queries.map((q) => ({
          results: database.prepare(q.sql).all(...q.params),
        }));
        database.exec("COMMIT");
        return results;
      } catch (error) {
        database.exec("ROLLBACK");
        throw error;
      }
    },
  };
});
afterEach(() => database.close());
function roles() {
  return database
    .prepare("SELECT user_id,role FROM workspace_members ORDER BY user_id")
    .all();
}
it("transfers ownership and both member roles together", async () => {
  await expect(acceptTransfer(recipient)).resolves.toEqual({ ok: true });
  expect(roles()).toEqual([
    { user_id: "alice", role: "editor" },
    { user_id: "bob", role: "owner" },
  ]);
  expect(
    database.prepare("SELECT created_by FROM workspaces").get()?.created_by,
  ).toBe("bob");
  expect(
    database.prepare("SELECT * FROM ownership_transfers").all(),
  ).toHaveLength(0);
});
it.each(["alice", "bob"])(
  "does not partially transfer if %s membership disappears before the batch",
  async (id) => {
    mocks.beforeBatch = () => {
      database.prepare("DELETE FROM workspace_members WHERE user_id=?").run(id);
    };
    await expect(acceptTransfer(recipient)).rejects.toMatchObject({
      status: 409,
    });
    expect(
      database.prepare("SELECT created_by FROM workspaces").get()?.created_by,
    ).toBe("alice");
    expect(roles()).toEqual(
      id === "bob"
        ? [{ user_id: "alice", role: "owner" }]
        : [{ user_id: "bob", role: "editor" }],
    );
  },
);
it("removing a recipient permanently cancels their pending ownership offer", async () => {
  await updateMember(owner, "bob", null);
  database.exec(
    "INSERT INTO workspace_members VALUES ('ws_team','bob','editor',2)",
  );
  await expect(acceptTransfer(recipient)).rejects.toMatchObject({
    status: 404,
  });
  expect(
    database.prepare("SELECT created_by FROM workspaces").get()?.created_by,
  ).toBe("alice");
});
it("a stale owner authorization cannot replace the current owner's offer", async () => {
  database.exec(
    "UPDATE workspaces SET created_by='bob'; UPDATE workspace_members SET role=CASE user_id WHEN 'bob' THEN 'owner' ELSE 'editor' END; DELETE FROM ownership_transfers;",
  );
  // Even a newly added member cannot be proposed by the former owner.
  database.exec(
    "INSERT INTO user(id,email) VALUES ('carol','carol@example.test'); INSERT INTO workspace_members VALUES ('ws_team','carol','editor',1)",
  );
  await expect(proposeTransfer(owner, "carol")).rejects.toMatchObject({
    status: 400,
  });
  expect(
    database.prepare("SELECT * FROM ownership_transfers").all(),
  ).toHaveLength(0);
});
