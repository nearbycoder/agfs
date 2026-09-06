import { DatabaseSync } from "node:sqlite";
import { SQLiteSyncDialect } from "drizzle-orm/sqlite-core";
import { describe, expect, it } from "vitest";
import { commitUploadStatement } from "./upload-commit";

it("checks quota and folder conflicts in the actual SQLite write", () => {
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE entries (id TEXT PRIMARY KEY, owner_id TEXT, parent_path TEXT, path TEXT, name TEXT, kind TEXT, size INTEGER, content_type TEXT, etag TEXT, r2_key TEXT, version_id TEXT, created_at INTEGER, updated_at INTEGER, UNIQUE(owner_id, path));
    CREATE TABLE uploads (id TEXT, owner_id TEXT, status TEXT, expires_at INTEGER DEFAULT 9999999999999);
    INSERT INTO uploads (id,owner_id,status) VALUES ('u1','owner','pending'),('u2','owner','pending'),('u3','owner','pending');`);
  const commit = (id: string, path: string, size: number, ownerId = "owner") => {
    const query = new SQLiteSyncDialect().sqlToQuery(commitUploadStatement({ id, ownerId, parentPath: "/", path, name: path.slice(1), kind: "file", size, contentType: "text/plain", etag: "etag", r2Key: id, versionId: id, createdAt: new Date(), updatedAt: new Date() }, id, 100));
    return db.prepare(query.sql).all(...query.params as any[]);
  };
  expect(commit("u1", "/one", 60)).toHaveLength(1);
  expect(commit("u2", "/two", 60)).toHaveLength(0);
  expect(commit("u2", "/one", 80)).toHaveLength(1);
  expect(commit("u3", "/foreign", 1, "other")).toHaveLength(0);
  db.exec("UPDATE uploads SET status = 'committed' WHERE id = 'u1'");
  expect(commit("u1", "/replayed", 1)).toHaveLength(0);
  db.exec("INSERT INTO entries (id,owner_id,path,kind) VALUES ('folder','owner','/folder','folder')");
  expect(commit("u3", "/folder", 1)).toHaveLength(0);
  db.close();
});
