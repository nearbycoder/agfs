import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { afterEach, expect, it } from "vitest";
import { SQLiteSyncDialect } from "drizzle-orm/sqlite-core";
import { moveStatement } from "./move-statement";

const databases: DatabaseSync[] = [];
afterEach(() => databases.splice(0).forEach((db) => db.close()));
function fixture() {
  const db = new DatabaseSync(":memory:");
  databases.push(db);
  db.exec(readFileSync(new URL("../../../../packages/db/src/migrations/0000_initial.sql", import.meta.url), "utf8"));
  db.exec(`INSERT INTO user(id,email) VALUES ('alice','alice@example.test');
    INSERT INTO entries(id,owner_id,path,parent_path,name,kind) VALUES
    ('root','alice','/scope','/','scope','folder'),
    ('child','alice','/scope/file','/scope','file','file'),
    ('neighbor','alice','/scoped/file','/scoped','file','file');`);
  const move = () => {
    const query = new SQLiteSyncDialect().sqlToQuery(moveStatement("alice", { id: "root", path: "/scope", kind: "folder" }, "/$&"));
    return db.prepare(query.sql).all(...query.params as any[]);
  };
  return { db, move };
}

it("moves the current literal subtree in one statement, preserving dollar sequences", () => {
  const { db, move } = fixture();
  expect(move()).toHaveLength(2);
  expect(db.prepare("SELECT path,parent_path FROM entries WHERE id='child'").get()).toMatchObject({ path: "/$&/file", parent_path: "/$&" });
  expect(db.prepare("SELECT path FROM entries WHERE id='neighbor'").get()?.path).toBe("/scoped/file");
});

it("does not follow a source ID moved outside the authorized path before execution", () => {
  const { db, move } = fixture();
  db.exec("UPDATE entries SET path='/private',parent_path='/' WHERE id='root'");
  expect(move()).toHaveLength(0);
  expect(db.prepare("SELECT path FROM entries WHERE id='root'").get()?.path).toBe("/private");
});

it("does not pull a previously selected child back from outside the scope", () => {
  const { db, move } = fixture();
  db.exec("UPDATE entries SET path='/private/file',parent_path='/private' WHERE id='child'");
  expect(move()).toHaveLength(1);
  expect(db.prepare("SELECT path FROM entries WHERE id='child'").get()?.path).toBe("/private/file");
});

it("rejects a destination subtree introduced before execution without moving anything", () => {
  const { db, move } = fixture();
  db.exec("UPDATE entries SET path='/$&/occupied',parent_path='/$&' WHERE id='neighbor'");
  expect(move()).toHaveLength(0);
  expect(db.prepare("SELECT path FROM entries WHERE id='root'").get()?.path).toBe("/scope");
});
