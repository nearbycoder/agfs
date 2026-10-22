import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";

export function serverFixture(throughMigration?: string) {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA foreign_keys=ON");
  const migrations = new URL("../../../../packages/db/src/migrations/", import.meta.url);
  for (const name of readdirSync(migrations).filter((name) => name.endsWith(".sql") && (!throughMigration || name <= throughMigration)).sort())
    sqlite.exec(readFileSync(new URL(name, migrations), "utf8"));
  sqlite.exec("INSERT INTO user(id,name,email) VALUES('alice','Alice','alice@example.test'),('bob','Bob','bob@example.test')");
  const fixture = {
    sqlite,
    calls: [] as Array<{ query: string; params: SQLInputValue[] }>,
    trips: 0,
    batches: [] as number[],
    beforeBatch: (_queries: string[]) => {},
    beforeStatement: (_query: string, _params: SQLInputValue[]) => {},
    entry(id: string, path = `/${id}`, owner = "alice", kind = "file", key: string | null = id) {
      sqlite.prepare(`INSERT INTO entries(id,owner_id,path,parent_path,name,kind,size,content_type,r2_key,etag)
        VALUES(?,?,?,?,?,?,10,'text/plain',?,'etag')`).run(id, owner, path, path.slice(0, path.lastIndexOf("/")) || "/", path.split("/").at(-1)!, kind, kind === "folder" ? null : key);
    },
    reset() { fixture.calls = []; fixture.trips = 0; fixture.batches = []; },
    plan(query: string, params: SQLInputValue[] = []) {
      return sqlite.prepare(`EXPLAIN QUERY PLAN ${query}`).all(...params).map((row) => String(row.detail)).join("\n");
    },
  };
  function prepare(query: string) {
    if (new TextEncoder().encode(query).length > 100_000) throw new Error("D1 SQL exceeds 100 KB");
    let params: SQLInputValue[] = [];
    const statement = {
      query,
      bind(...values: SQLInputValue[]) {
        if (values.length > 100) throw new Error(`D1 bound parameter limit: ${values.length} > 100`);
        if (values.some((value) => typeof value === "string" && new TextEncoder().encode(value).length > 2_000_000))
          throw new Error("D1 string exceeds 2 MB");
        params = values;
        return statement;
      },
      execute() {
        fixture.calls.push({ query, params });
        fixture.beforeStatement(query, params);
        const results = sqlite.prepare(query).all(...params);
        return { results, success: true, meta: { changes: Number(sqlite.prepare("SELECT changes() AS n").get()!.n) } };
      },
      async all() { fixture.trips++; return statement.execute(); },
      async run() { fixture.trips++; return statement.execute(); },
      async raw() { fixture.trips++; return statement.execute().results.map((row) => Object.values(row)); },
    };
    return statement;
  }
  const binding = {
    prepare,
    async batch(statements: ReturnType<typeof prepare>[]) {
      fixture.trips++;
      fixture.batches.push(statements.length);
      fixture.beforeBatch(statements.map((statement) => statement.query));
      sqlite.exec("BEGIN");
      try {
        const results = statements.map((statement) => statement.execute());
        sqlite.exec("COMMIT");
        return results;
      } catch (error) {
        sqlite.exec("ROLLBACK");
        throw error;
      }
    },
  };
  return Object.assign(fixture, { binding });
}

export function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
