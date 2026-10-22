import { sql, type SQLWrapper } from "drizzle-orm";

/** Literal subtree bounds for normalized paths and SQLite's BINARY collation. */
export function pathRange(column: SQLWrapper, path: string, includeSelf = false) {
  const prefix = path === "/" ? "/" : `${path}/`;
  // '/' sorts immediately before '0'. No wildcard escaping or Unicode sentinel
  // is needed, even when the folder name itself contains Unicode, '%' or '_'.
  const end = path === "/" ? "0" : `${path}0`;
  if (!includeSelf || path === "/")
    return sql`(${column} >= ${prefix} AND ${column} < ${end})`;
  // Retain the exact root alongside descendants while excluding names such as
  // '/folder-other'. The outer bounds let (owner_id,path) seek into the subtree.
  return sql`(${column} >= ${path} AND ${column} < ${end} AND (${column} = ${path} OR ${column} >= ${prefix}))`;
}
