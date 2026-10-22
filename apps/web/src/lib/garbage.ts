import { sql } from "drizzle-orm";
import { db } from "./db";
import { requireResourceBindings } from "./bindings";
import { atomicBatch } from "./atomic-batch";
export function queueObject(key: string) {
  return sql`INSERT INTO object_gc(r2_key,created_at) VALUES (${key},${Date.now()}) ON CONFLICT(r2_key) DO UPDATE SET created_at=excluded.created_at`;
}
export async function collectGarbage() {
  // A new reference can only be restored from existing metadata. Once none remains,
  // this unique object key can never be published again.
  const unreferenced = sql`NOT EXISTS (SELECT 1 FROM entries WHERE r2_key=gc.r2_key)
      AND NOT EXISTS (SELECT 1 FROM recovery WHERE r2_key=gc.r2_key)
      AND NOT EXISTS (SELECT 1 FROM object_pins WHERE object_key=gc.r2_key AND expires_at>unixepoch()*1000)
      AND NOT EXISTS (SELECT 1 FROM uploads WHERE object_key=gc.r2_key AND status IN ('pending','completing'))`;
  const at = Date.now();
  const state = await db.run(sql`SELECT cursor FROM resource_scheduler WHERE name='garbage'`);
  let position: [number, string, number] = [-1, "", at];
  if (state.results[0]?.cursor) { try { position = JSON.parse(String(state.results[0].cursor)); } catch { /* restart malformed administrative state */ } }
  const page = (p: typeof position) => db.run(sql`SELECT r2_key,generation,created_at FROM resource_object_gc
    WHERE created_at<=${Math.min(at, p[2])} AND (created_at,r2_key)>(${p[0]},${p[1]}) ORDER BY created_at,r2_key LIMIT 100`);
  let candidates = await page(position);
  if (!candidates.results.length && state.results[0]?.cursor) { position = [-1, "", at]; candidates = await page(position); }
  if (!candidates.results.length) return;
  try {
    const last = candidates.results.at(-1)!;
    await atomicBatch([sql`INSERT INTO resource_scheduler(name,cursor,updated_at) VALUES('garbage',${JSON.stringify([last.created_at, last.r2_key, position[2]])},${at})
      ON CONFLICT(name) DO UPDATE SET cursor=excluded.cursor,updated_at=excluded.updated_at`]);
    // Recheck live references and the selected generation immediately before
    // issuing deletes. Legitimate restores require surviving reference metadata.
    const selected = JSON.stringify(candidates.results);
    const current = await db.run(sql`SELECT r2_key,generation FROM resource_object_gc AS gc
      WHERE (r2_key,generation) IN (SELECT json_extract(value,'$.r2_key'),json_extract(value,'$.generation') FROM json_each(${selected})) AND ${unreferenced}`);
    if (!current.results.length) return;
    const keys: string[] = current.results.map((row: { r2_key: unknown }) => String(row.r2_key));
    // Selection remains bounded at 100. Only discard durable retry metadata
    // after R2 confirms deletion of the whole batch; repeating deletes is safe.
    await requireResourceBindings("FILES_BUCKET").FILES_BUCKET.delete(keys);
    const encoded = JSON.stringify(current.results);
    const settled = sql`SELECT gc.r2_key FROM resource_object_gc gc
      WHERE (gc.r2_key,gc.generation) IN (SELECT json_extract(value,'$.r2_key'),json_extract(value,'$.generation') FROM json_each(${encoded})) AND ${unreferenced}`;
    await atomicBatch([
      sql`DELETE FROM object_usage WHERE object_key IN (${settled})`,
      sql`DELETE FROM object_gc WHERE r2_key IN (${settled})`,
      // Legacy collectors can remove object_gc, but cannot remove this newer
      // intent. The next bounded turn discovers it without a legacy queue row.
      sql`DELETE FROM resource_object_gc WHERE r2_key IN (${settled})`,
    ]);
  } catch (error) {
    console.error(
      "Object cleanup will retry",
      error instanceof Error ? error.name : "Unknown error",
    );
  }
}
