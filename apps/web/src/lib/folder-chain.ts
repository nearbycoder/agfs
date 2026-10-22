import { sql } from "drizzle-orm";
import { createAgfsId, normalizeAgfsPath } from "@agfs/db";

/** Both statements must run in the same D1 transaction. */
export function folderChainStatements(ownerId: string, path: string) {
  const folders = [];
  let current = "";
  for (const name of normalizeAgfsPath(path).split("/").filter(Boolean)) {
    const parent = current || "/";
    current += `/${name}`;
    folders.push({ id: createAgfsId("ent"), path: current, parent, name });
  }
  const encoded = JSON.stringify(folders);
  const at = Date.now();
  const conflict = sql`SELECT e.path FROM json_each(${encoded}) f
    JOIN entries e ON e.owner_id=${ownerId} AND e.path=json_extract(f.value,'$.path')
    WHERE e.kind!='folder' ORDER BY f.key LIMIT 1`;
  return [
    conflict,
    sql`INSERT INTO entries(id,owner_id,parent_path,path,name,kind,created_at,updated_at)
      SELECT json_extract(f.value,'$.id'),${ownerId},json_extract(f.value,'$.parent'),
        json_extract(f.value,'$.path'),json_extract(f.value,'$.name'),'folder',${at},${at}
      FROM json_each(${encoded}) f WHERE NOT EXISTS(${conflict}) ORDER BY f.key
      ON CONFLICT(owner_id,path) DO NOTHING`,
  ];
}
