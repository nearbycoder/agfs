import { SQL } from "drizzle-orm";
import { SQLiteSyncDialect } from "drizzle-orm/sqlite-core";
import { requireResourceBindings } from "./bindings";
/** D1's native batch is transactional. Drizzle's D1 batch cannot mix raw SQL queries. */
export async function atomicBatch(queries: Array<SQL | { toSQL(): { sql: string; params: unknown[] } }>) {
  const database = requireResourceBindings("DB").DB;
  const dialect = new SQLiteSyncDialect();
  return database.batch(
    queries.map((query) => {
      const compiled = "toSQL" in query ? query.toSQL() : dialect.sqlToQuery(query);
      return database.prepare(compiled.sql).bind(...compiled.params);
    }),
  );
}
