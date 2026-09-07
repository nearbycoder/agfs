#!/usr/bin/env node
// Operator-only D1 + R2 archive. Requires an authenticated Wrangler CLI.
import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  lstatSync,
  readFileSync,
  writeFileSync,
  chmodSync,
  existsSync,
  createReadStream,
} from "node:fs";
import { resolve, join } from "node:path";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
const [mode, directory] = process.argv.slice(2);
if (!["export", "verify"].includes(mode) || !directory)
  throw Error("Usage: node scripts/service-backup.mjs export|verify DIRECTORY");
process.umask(0o077);
const root = resolve(directory);
mkdirSync(root, { recursive: true, mode: 0o700 });
const st = lstatSync(root);
if (!st.isDirectory() || st.isSymbolicLink() || st.mode & 0o077)
  throw Error("Use a private directory (0700)");
const wrangler = resolve("apps/web/node_modules/wrangler/bin/wrangler.js");
function run(args) {
  try {
    return execFileSync(
      process.execPath,
      [
        wrangler,
        ...args,
        "--config",
        "apps/web/wrangler.jsonc",
        "--env",
        "production",
      ],
      {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        maxBuffer: 32 * 1024 * 1024,
      },
    );
  } catch {
    throw Error(
      "Wrangler backup operation failed; no archive has been marked complete.",
    );
  }
}
async function hash(file) {
  const h = createHash("sha256");
  let size = 0;
  const st = lstatSync(file);
  if (!st.isFile() || st.isSymbolicLink()) throw Error("Unsafe archive file");
  for await (const chunk of createReadStream(file)) {
    h.update(chunk);
    size += chunk.length;
  }
  return { sha256: h.digest("hex"), size };
}
function importDatabase() {
  const d = new DatabaseSync(":memory:");
  d.exec(readFileSync(join(root, "database.sql"), "utf8"));
  return d;
}
function rebuildSearch(d) {
  d.exec(
    "CREATE VIRTUAL TABLE IF NOT EXISTS file_search USING fts5(entry_id UNINDEXED,name,content,tags); INSERT INTO file_search(entry_id,name,content,tags) SELECT e.id,e.name,s.content,s.tags FROM entries e JOIN search_documents s ON s.entry_id=e.id AND s.object_key IS e.r2_key;",
  );
}
if (mode === "export") {
  if (
    existsSync(join(root, "manifest.json")) ||
    existsSync(join(root, "database.sql"))
  )
    throw Error("Use a new empty backup directory");
  // Explicit ordinary tables avoid D1's FTS5 export limitation. One export captures
  // all selected tables at the same bookmark; search is derived and rebuilt below.
  const result = JSON.parse(
    run([
      "d1",
      "execute",
      "agfs-db",
      "--remote",
      "--command",
      "SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'file_search%' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'",
      "--json",
    ]),
  );
  const tables = result[0].results.map((r) => r.name);
  run([
    "d1",
    "export",
    "agfs-db",
    "--remote",
    "--table",
    ...tables,
    "--output",
    join(root, "database.sql"),
    "-y",
  ]);
  chmodSync(join(root, "database.sql"), 0o600);
  const d = importDatabase(),
    at = Date.now();
  const hasPins = d
    .prepare("SELECT 1 FROM sqlite_schema WHERE name='object_pins'")
    .get();
  const keys = d
    .prepare(
      "SELECT r2_key AS key FROM entries WHERE r2_key IS NOT NULL UNION SELECT r2_key FROM recovery WHERE r2_key IS NOT NULL AND expires_at>" +
        at +
        (hasPins
          ? " UNION SELECT object_key FROM object_pins WHERE expires_at>" + at
          : ""),
    )
    .all();
  rebuildSearch(d);
  d.close();
  const objects = [];
  for (const { key } of keys) {
    if (typeof key !== "string" || !key || key.includes("\0"))
      throw Error("Invalid object reference");
    const file = createHash("sha256").update(key).digest("hex") + ".blob";
    run([
      "r2",
      "object",
      "get",
      "agfs-files/" + key,
      "--remote",
      "--file",
      join(root, file),
    ]);
    chmodSync(join(root, file), 0o600);
    objects.push({ key, file, ...(await hash(join(root, file))) });
  }
  writeFileSync(
    join(root, "manifest.json"),
    JSON.stringify(
      {
        version: 1,
        createdAt: new Date().toISOString(),
        database: await hash(join(root, "database.sql")),
        objects,
      },
      null,
      2,
    ),
    { mode: 0o600, flag: "wx" },
  );
  console.log(
    `Archived database and ${objects.length} retained objects. Run verify before relying on it.`,
  );
} else {
  const manifest = JSON.parse(
    readFileSync(join(root, "manifest.json"), "utf8"),
  );
  for (const item of [
    { file: "database.sql", ...manifest.database },
    ...manifest.objects,
  ]) {
    if (item.file !== "database.sql" && !/^[a-f0-9]{64}\.blob$/.test(item.file))
      throw Error("Invalid archive filename");
    const actual = await hash(join(root, item.file));
    if (actual.sha256 !== item.sha256 || actual.size !== item.size)
      throw Error("Archive checksum mismatch");
  }
  const d = importDatabase();
  rebuildSearch(d);
  if (d.prepare("PRAGMA integrity_check").get().integrity_check !== "ok")
    throw Error("Database integrity check failed");
  const errors = d.prepare("PRAGMA foreign_key_check").all();
  if (errors.length) throw Error("Database foreign key check failed");
  d.close();
  console.log(
    "Database restore and search rebuild passed; all object checksums verified.",
  );
}
