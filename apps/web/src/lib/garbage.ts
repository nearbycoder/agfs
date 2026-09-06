import { sql } from "drizzle-orm";
import { db } from "./db";
import { requireResourceBindings } from "./bindings";
export function queueObject(key: string) {
  return sql`INSERT INTO object_gc(r2_key,created_at) VALUES (${key},${Date.now()}) ON CONFLICT(r2_key) DO NOTHING`;
}
export async function collectGarbage() {
  // A new reference can only be restored from existing metadata. Once none remains,
  // this unique object key can never be published again.
  const rows = await db.run(sql`SELECT r2_key FROM object_gc AS gc
    WHERE NOT EXISTS (SELECT 1 FROM entries WHERE r2_key=gc.r2_key)
      AND NOT EXISTS (SELECT 1 FROM recovery WHERE r2_key=gc.r2_key)
      AND NOT EXISTS (SELECT 1 FROM uploads WHERE object_key=gc.r2_key AND status IN ('pending','completing'))
    ORDER BY created_at LIMIT 100`);
  for (const row of rows.results) {
    const key = String(row.r2_key);
    try {
      await requireResourceBindings("FILES_BUCKET").FILES_BUCKET.delete(key);
      await db.run(sql`DELETE FROM object_gc WHERE r2_key=${key}`);
    } catch (error) {
      console.error("Object cleanup will retry", error instanceof Error ? error.name : "Unknown error");
    }
  }
}
