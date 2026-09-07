import { it, expect } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { scanSecrets } from "./secret-scan";
import { encodeCursor, decodeCursor } from "./cursor";
function database() {
  const d = new DatabaseSync(":memory:");
  d.exec("PRAGMA foreign_keys=ON");
  const dir = new URL(
    "../../../../packages/db/src/migrations/",
    import.meta.url,
  );
  for (const f of readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort())
    d.exec(readFileSync(new URL(f, dir), "utf8"));
  d.exec(
    "INSERT INTO user(id,email) VALUES('alice','alice@test.invalid'),('bob','bob@test.invalid');",
  );
  return d;
}
it("records both sides of a rename without leaking another namespace", () => {
  const d = database();
  d.exec(
    "INSERT INTO entries(id,owner_id,path,name,kind) VALUES('e','alice','/old','old','folder'); UPDATE entries SET path='/new',name='new' WHERE id='e';",
  );
  expect(
    d.prepare("SELECT path,operation FROM change_log ORDER BY seq").all(),
  ).toEqual([
    { path: "/old", operation: "upsert" },
    { path: "/old", operation: "delete" },
    { path: "/new", operation: "upsert" },
  ]);
  expect(
    d
      .prepare("SELECT count(*) AS n FROM change_log WHERE owner_id='bob'")
      .get()!.n,
  ).toBe(0);
});
it("revokes shares when file content changes and leaves unrelated versions alone", () => {
  const d = database();
  d.exec(
    "INSERT INTO entries(id,owner_id,path,name,kind,r2_key) VALUES('e','alice','/file','file','file','old'); INSERT INTO share_links(id,owner_id,entry_id,token_hash,prefix,expires_at) VALUES('share','alice','e','hash','prefix',9999999999999); UPDATE entries SET name='renamed' WHERE id='e';",
  );
  expect(d.prepare("SELECT count(*) AS n FROM share_links").get()!.n).toBe(1);
  d.exec("UPDATE entries SET r2_key='new' WHERE id='e'");
  expect(d.prepare("SELECT count(*) AS n FROM share_links").get()!.n).toBe(0);
});
it("detects credential patterns without returning secret values", () => {
  const text =
    'hello\n-----BEGIN PRIVATE KEY-----\napi_key="abcdefghijklmnop123456"';
  const findings = scanSecrets(text);
  expect(findings).toEqual([
    { type: "Private key", line: 2 },
    { type: "Assigned secret", line: 3 },
  ]);
  expect(JSON.stringify(findings)).not.toContain("abcdefghijklmnop");
  expect(scanSecrets("The password field is optional.")).toEqual([]);
});
it("rejects malformed or differently scoped cursors", () => {
  const c = encodeCursor({ scope: "alice", path: "/a" });
  expect(decodeCursor(c, (v) => v.scope === "alice")).toEqual({
    scope: "alice",
    path: "/a",
  });
  expect(() => decodeCursor(c, (v) => v.scope === "bob")).toThrow();
  expect(() => decodeCursor("notbase64", () => true)).toThrow();
});
it("keeps idempotency reservations unique under conflicting requests", () => {
  const d = database();
  d.exec("INSERT INTO idempotency VALUES('alice','key','first',NULL,NULL,1)");
  expect(() =>
    d.exec(
      "INSERT INTO idempotency VALUES('alice','key','second',NULL,NULL,1)",
    ),
  ).toThrow();
  expect(
    d.prepare("SELECT fingerprint FROM idempotency").get()!.fingerprint,
  ).toBe("first");
});

it("preserves old-worker index inserts after the additive migration", () => {
  const d = database();
  d.exec(
    "INSERT INTO entries(id,owner_id,path,name,kind) VALUES('e','alice','/f','f','file'); DELETE FROM index_jobs; INSERT OR IGNORE INTO index_jobs VALUES('e');",
  );
  expect(
    d.prepare("SELECT attempts FROM index_job_status WHERE entry_id='e'").get()!
      .attempts,
  ).toBe(0);
  d.exec("DELETE FROM index_jobs WHERE entry_id='e'");
  expect(d.prepare("SELECT count(*) AS n FROM index_job_status").get()!.n).toBe(
    0,
  );
});
