import { sql } from "drizzle-orm";
import { db } from "./db";
import { requireResourceBindings } from "./bindings";
import { atomicBatch } from "./atomic-batch";
export function queueObject(key: string) {
  return sql`INSERT INTO object_gc(r2_key,created_at) VALUES (${key},${Date.now()}) ON CONFLICT(r2_key) DO NOTHING`;
}
export async function collectGarbage() {
  // A new reference can only be restored from existing metadata. Once none remains,
  // this unique object key can never be published again.
  const rows = await db.run(sql`SELECT r2_key FROM object_gc AS gc
    WHERE NOT EXISTS (SELECT 1 FROM entries WHERE r2_key=gc.r2_key)
      AND NOT EXISTS (SELECT 1 FROM recovery WHERE r2_key=gc.r2_key)
      AND NOT EXISTS (SELECT 1 FROM object_pins WHERE object_key=gc.r2_key AND expires_at>unixepoch()*1000)
      AND NOT EXISTS (SELECT 1 FROM uploads WHERE object_key=gc.r2_key AND status IN ('pending','completing'))
    ORDER BY created_at LIMIT 100`);
  const keys: string[] = rows.results.map((row: { r2_key: unknown }) => String(row.r2_key));
  if (!keys.length) return;
  try {
    // Selection remains bounded at 100. Only discard durable retry metadata
    // after R2 confirms deletion of the whole batch; repeating deletes is safe.
    await requireResourceBindings("FILES_BUCKET").FILES_BUCKET.delete(keys);
    const encoded = JSON.stringify(keys);
    await atomicBatch([
      sql`DELETE FROM object_usage WHERE object_key IN (SELECT value FROM json_each(${encoded}))`,
      sql`DELETE FROM object_gc WHERE r2_key IN (SELECT value FROM json_each(${encoded}))`,
    ]);
  } catch (error) {
    console.error(
      "Object cleanup will retry",
      error instanceof Error ? error.name : "Unknown error",
    );
  }
}
