import { SQL } from "drizzle-orm";
import { SQLiteSyncDialect } from "drizzle-orm/sqlite-core";
import { requireResourceBindings } from "./bindings";
export async function rows<T = Record<string, any>>(
  statement: SQL,
): Promise<T[]> {
  const query = new SQLiteSyncDialect().sqlToQuery(statement);
  const result = await requireResourceBindings("DB")
    .DB.prepare(query.sql)
    .bind(...query.params)
    .all<T>();
  return result.results;
}
export async function first<T = Record<string, any>>(
  statement: SQL,
): Promise<T | undefined> {
  return (await rows<T>(statement))[0];
}
