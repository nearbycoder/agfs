import { encodeCursor, decodeCursor } from "./cursor";
import { sql } from "drizzle-orm";
import { normalizeAgfsPath } from "@agfs/db";
import { rows, first } from "./platform-db";
import { atomicBatch } from "./atomic-batch";
import { requireResourceBindings } from "./bindings";
import type { RequestAuth } from "./authz";
import { authorize } from "./scope";
import { errorResponse } from "./http";
export function searchTerms(input: string) {
  return (input.match(/[\p{L}\p{N}_-]+/gu) ?? [])
    .slice(0, 8)
    .map((t) => '"' + t.replaceAll('"', '""') + '"*')
    .join(" AND ");
}
export async function indexFiles(limit = 20, entryId?: string) {
  const jobs = await rows(
    sql`SELECT e.* FROM index_jobs j JOIN index_job_status s ON s.entry_id=j.entry_id JOIN entries e ON e.id=j.entry_id WHERE (${entryId ?? null} IS NULL OR e.id=${entryId ?? null}) AND s.next_attempt<=${Date.now()} ORDER BY s.queued_at LIMIT ${limit}`,
  );
  for (const e of jobs) {
    try {
      let content = "";
      if (
        e.kind === "file" &&
        e.size <= 1048576 &&
        /^(text\/|application\/(json|xml|javascript|x-yaml))/.test(
          e.content_type ?? "",
        )
      ) {
        const object = await requireResourceBindings(
          "FILES_BUCKET",
        ).FILES_BUCKET.get(e.r2_key);
        if (object && object.size <= 1048576) content = await object.text();
        else await object?.body?.cancel();
      }
      await atomicBatch([
        sql`INSERT INTO search_documents(entry_id,object_key,content,indexed_at)
          SELECT id,r2_key,${content},${Date.now()} FROM entries WHERE id=${e.id} AND r2_key IS ${e.r2_key}
          ON CONFLICT(entry_id) DO UPDATE SET object_key=excluded.object_key,content=excluded.content,indexed_at=excluded.indexed_at`,
        sql`DELETE FROM file_search WHERE entry_id=${e.id}`,
        sql`INSERT INTO file_search(entry_id,name,content,tags) SELECT e.id,e.name,d.content,d.tags FROM entries e
          JOIN search_documents d ON d.entry_id=e.id AND d.object_key IS e.r2_key WHERE e.id=${e.id}`,
        sql`DELETE FROM index_jobs WHERE entry_id=${e.id} AND EXISTS(SELECT 1 FROM entries WHERE id=${e.id} AND r2_key IS ${e.r2_key} AND updated_at=${e.updated_at})`,
      ]);
    } catch (error) {
      await rows(
        sql`UPDATE index_job_status SET attempts=attempts+1,last_error='Object could not be indexed',next_attempt=${Date.now() + 60000} WHERE entry_id=${e.id}`,
      );
      if (entryId) throw error;
      console.error(
        "Search indexing will retry",
        e.id,
        error instanceof Error ? error.name : "error",
      );
    }
  }
  return jobs.length;
}
export async function searchFiles(
  auth: RequestAuth,
  input: {
    q: string;
    path?: string;
    type?: string;
    tag?: string;
    offset?: number;
    cursor?: string;
  },
) {
  const path = normalizeAgfsPath(input.path ?? auth.pathPrefix ?? "/"),
    prefix = path === "/" ? "/" : path + "/";
  authorize(auth, "read", path);
  const terms = searchTerms(input.q);
  const scope = JSON.stringify([
    auth.user.id,
    path,
    input.q,
    input.type,
    input.tag,
  ]);
  const cursor = decodeCursor<{ path: string; scope: string }>(
    input.cursor,
    (v) => typeof v?.path === "string" && v.scope === scope,
  );
  const matches =
    await rows(sql`SELECT e.id,e.path,e.name,e.kind,e.size,e.content_type AS contentType,e.etag,
    d.tags,substr(d.content,1,240) AS excerpt,d.indexed_at AS indexedAt
    FROM entries e LEFT JOIN search_documents d ON d.entry_id=e.id AND d.object_key IS e.r2_key
    WHERE e.owner_id=${auth.user.id} AND (e.path=${path} OR substr(e.path,1,length(${prefix}))=${prefix})
    AND (${input.type ?? null} IS NULL OR e.content_type=${input.type ?? null})
    AND (${input.tag ?? null} IS NULL OR EXISTS(SELECT 1 FROM json_each(coalesce(d.tags,'[]')) WHERE value=${input.tag ?? null}))
    AND (${input.q}='' OR instr(lower(e.name),lower(${input.q}))>0
      OR e.id IN (SELECT entry_id FROM file_search WHERE file_search MATCH ${terms || '"__no_terms__"'}))
    AND e.path>${cursor?.path ?? ""}
    ORDER BY e.path LIMIT 51 OFFSET ${cursor ? 0 : (input.offset ?? 0)}`);
  return {
    results: matches
      .slice(0, 50)
      .map((r) => ({ ...r, tags: JSON.parse(r.tags ?? "[]") })),
    nextOffset: matches.length > 50 ? (input.offset ?? 0) + 50 : null,
    nextCursor:
      matches.length > 50
        ? encodeCursor({ path: matches[49].path, scope })
        : null,
  };
}
export async function tagFile(auth: RequestAuth, path: string, tags: string[]) {
  path = normalizeAgfsPath(path);
  authorize(auth, "write", path);
  const e = await first(
    sql`SELECT * FROM entries WHERE owner_id=${auth.user.id} AND path=${path}`,
  );
  if (!e) throw errorResponse(404, "File not found");
  await atomicBatch([
    sql`INSERT INTO search_documents(entry_id,object_key,tags,indexed_at) VALUES (${e.id},${e.r2_key},${JSON.stringify([...new Set(tags)])},0)
      ON CONFLICT(entry_id) DO UPDATE SET tags=excluded.tags`,
    sql`INSERT OR IGNORE INTO index_jobs(entry_id) VALUES (${e.id})`,
  ]);
  return { ok: true };
}
