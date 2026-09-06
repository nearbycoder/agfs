import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { it, expect } from "vitest";
import { SQLiteSyncDialect } from "drizzle-orm/sqlite-core";
import { storageUsageSql } from "./storage-usage";
it("migration preserves legacy scopes and atomically retains overwritten object versions", () => {
  const db = new DatabaseSync(":memory:");
  for (const name of ["0000_initial.sql", "0001_upload_tokens.sql", "0002_agent_filesystem.sql", "0003_object_gc.sql"])
    db.exec(readFileSync(new URL(`../../../../packages/db/src/migrations/${name}`, import.meta.url), "utf8"));
  db.exec(`INSERT INTO user(id,email) VALUES ('alice','a@example.com'); INSERT INTO api_tokens(id,owner_id,label,prefix,token_hash) VALUES ('token','alice','old','prefix','hash');
    INSERT INTO entries(id,owner_id,path,name,kind,size,r2_key) VALUES ('file','alice','/file','file','file',10,'old');
    UPDATE entries SET size=20,r2_key='new' WHERE id='file';`);
  expect(db.prepare("SELECT path_prefix,permissions FROM api_tokens").get()).toMatchObject({
    path_prefix: "/",
    permissions: '["read","write","delete","share","manage"]',
  });
  expect(db.prepare("SELECT reason,size,r2_key FROM recovery").get()).toMatchObject({
    reason: "version",
    size: 10,
    r2_key: "old",
  });
  const usage = () => {
    const q = new SQLiteSyncDialect().sqlToQuery(storageUsageSql("alice"));
    return db.prepare(`SELECT ${q.sql} AS bytes`).get(...(q.params as any[]))?.bytes;
  };
  expect(usage()).toBe(30);
  db.exec(
    `INSERT INTO entries(id,owner_id,path,name,kind,size,r2_key) VALUES ('restored','alice','/restored','restored','file',10,'old')`,
  );
  expect(usage()).toBe(30); // Restoring a retained physical object never double-counts it.
  db.close();
});
