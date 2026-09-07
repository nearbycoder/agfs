import { DatabaseSync } from "node:sqlite";
import { SQLiteSyncDialect } from "drizzle-orm/sqlite-core";
import { describe, expect, it } from "vitest";
import { commitUploadStatement } from "./upload-commit";

it("checks quota and folder conflicts in the actual SQLite write", () => {
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE entries (id TEXT PRIMARY KEY, owner_id TEXT, parent_path TEXT, path TEXT, name TEXT, kind TEXT, size INTEGER, content_type TEXT, etag TEXT, r2_key TEXT, version_id TEXT, created_at INTEGER, updated_at INTEGER, token_id TEXT, UNIQUE(owner_id, path));
    CREATE TABLE recovery (owner_id TEXT, r2_key TEXT, size INTEGER, kind TEXT);
    CREATE TABLE uploads (id TEXT, owner_id TEXT, status TEXT, expires_at INTEGER DEFAULT 9999999999999,condition_mode TEXT DEFAULT 'any',expected_etag TEXT);
    CREATE TABLE api_tokens(id TEXT,paused INTEGER,revoked_at INTEGER,expires_at INTEGER,storage_limit INTEGER);
    CREATE TABLE workspaces(id TEXT,paused INTEGER,storage_limit INTEGER);
    CREATE TABLE workspace_members(workspace_id TEXT,user_id TEXT,role TEXT);
    CREATE TABLE object_usage(token_id TEXT,size INTEGER,owner_id TEXT,object_key TEXT);
    CREATE TABLE object_pins(object_key TEXT,expires_at INTEGER);
    INSERT INTO uploads (id,owner_id,status) VALUES ('u1','owner','pending'),('u2','owner','pending'),('u3','owner','pending');`);
  const commit = (
    id: string,
    path: string,
    size: number,
    ownerId = "owner",
  ) => {
    const query = new SQLiteSyncDialect().sqlToQuery(
      commitUploadStatement(
        {
          id,
          ownerId,
          parentPath: "/",
          path,
          name: path.slice(1),
          kind: "file",
          size,
          contentType: "text/plain",
          etag: "etag",
          r2Key: id,
          versionId: id,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        id,
        100,
      ),
    );
    return db.prepare(query.sql).all(...(query.params as any[]));
  };
  expect(commit("u1", "/one", 60)).toHaveLength(1);
  expect(commit("u2", "/two", 60)).toHaveLength(0);
  expect(commit("u2", "/one", 80)).toHaveLength(0);
  expect(commit("u2", "/one", 40)).toHaveLength(1);
  expect(commit("u3", "/foreign", 1, "other")).toHaveLength(0);
  db.exec("UPDATE uploads SET status = 'committed' WHERE id = 'u1'");
  expect(commit("u1", "/replayed", 1)).toHaveLength(0);
  db.exec(
    "INSERT INTO entries (id,owner_id,path,kind) VALUES ('folder','owner','/folder','folder')",
  );
  expect(commit("u3", "/folder", 1)).toHaveLength(0);
  db.close();
});
