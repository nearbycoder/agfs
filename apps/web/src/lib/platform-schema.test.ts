import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { expect, it } from "vitest";
function database() {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys=ON");
  const dir = new URL(
    "../../../../packages/db/src/migrations/",
    import.meta.url,
  );
  for (const file of readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort())
    db.exec(readFileSync(new URL(file, dir), "utf8"));
  db.exec(
    "INSERT INTO user(id,name,email) VALUES ('owner','Owner','owner@test.invalid')",
  );
  return db;
}
it("migrates every schema and preserves indexing through an overwrite upsert", () => {
  const db = database();
  db.exec(
    "INSERT INTO entries(id,owner_id,path,name,kind,r2_key,etag) VALUES ('e','owner','/file','file','file','r2-v1','v1')",
  );
  db.exec(
    "INSERT INTO entries(id,owner_id,path,name,kind,r2_key,etag) VALUES ('new','owner','/file','file','file','r2-v2','v2') ON CONFLICT(owner_id,path) DO UPDATE SET r2_key=excluded.r2_key,etag=excluded.etag",
  );
  expect(db.prepare("SELECT count(*) AS n FROM index_jobs").get()!.n).toBe(1);
  expect(db.prepare("SELECT r2_key FROM recovery").get()!.r2_key).toBe("r2-v1");
  db.exec("INSERT INTO file_search VALUES ('e','file','nebula','release')");
  expect(
    db
      .prepare(
        "SELECT count(*) AS n FROM file_search WHERE file_search MATCH 'nebula'",
      )
      .get()!.n,
  ).toBe(1);
  db.exec("DELETE FROM entries WHERE id='e'");
  expect(db.prepare("SELECT count(*) AS n FROM file_search").get()!.n).toBe(0);
  db.close();
});
it("queues webhook events only for exact namespace, folder boundary and enabled subscriptions", () => {
  const db = database();
  db.exec(
    "INSERT INTO webhooks(id,owner_id,url,path_prefix,events,secret,created_at) VALUES ('hook','owner','https://hooks.agfs.dev','/allowed','[\"upload.commit\"]','secret',1)",
  );
  const event = db.prepare(
    "INSERT INTO activity(id,owner_id,actor,action,path,created_at) VALUES (?,?,?,?,?,?)",
  );
  event.run("a", "owner", "Owner", "upload.commit", "/allowed/file", 1);
  event.run("b", "owner", "Owner", "upload.commit", "/allowed-other/file", 2);
  event.run("c", "owner", "Owner", "download", "/allowed/file", 3);
  expect(db.prepare("SELECT event_id FROM webhook_deliveries").all()).toEqual([
    { event_id: "a" },
  ]);
  db.exec("UPDATE webhooks SET enabled=0");
  event.run("d", "owner", "Owner", "upload.commit", "/allowed/second", 4);
  expect(
    db.prepare("SELECT count(*) AS n FROM webhook_deliveries").get()!.n,
  ).toBe(1);
  db.close();
});
