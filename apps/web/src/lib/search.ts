import { encodeCursor, decodeCursor } from "./cursor";
import { sql } from "drizzle-orm";
import { normalizeAgfsPath } from "@agfs/db";
import { rows, first } from "./platform-db";
import { atomicBatch } from "./atomic-batch";
import { requireResourceBindings } from "./bindings";
import type { RequestAuth } from "./authz";
import { authorize } from "./scope";
import { errorResponse } from "./http";
import { pathRange } from "./path-range";
export function searchTerms(input: string) {
  return (input.match(/[\p{L}\p{N}_-]+/gu) ?? [])
    .slice(0, 8)
    .map((t) => '"' + t.replaceAll('"', '""') + '"*')
    .join(" AND ");
}
export async function indexFiles(limit = 20, entryId?: string, generation?: number) {
  const jobs = await rows(
    sql`SELECT e.*,r.generation AS job_generation,coalesce(p.index_mode,'content') AS index_mode,coalesce(p.max_text_bytes,1048576) AS max_text_bytes,
      coalesce(p.revision,0) AS policy_revision,CASE WHEN d.indexed_at>0 AND d.content_verified=1
        AND coalesce(p.index_mode,'content')='content'
        AND (coalesce(p.max_text_bytes,1048576)=1048576 OR length(CAST(d.content AS BLOB))<=p.max_text_bytes) THEN 1 ELSE 0 END AS reusable
      FROM index_jobs j JOIN index_job_status s ON s.entry_id=j.entry_id JOIN entries e ON e.id=j.entry_id
      JOIN resource_work r ON r.kind='index' AND r.id=j.entry_id
      LEFT JOIN search_documents d ON d.entry_id=e.id AND d.object_key IS e.r2_key
      LEFT JOIN resource_policies p ON p.owner_id=e.owner_id
      WHERE ${entryId ? sql`e.id=${entryId}` : sql`true`} AND s.next_attempt<=${Date.now()} AND coalesce(p.indexing_paused,0)=0
        AND (${generation ?? null} IS NULL OR r.generation=${generation ?? null})
      ORDER BY s.queued_at LIMIT ${Math.min(20, Math.max(0, Math.trunc(limit) || 0))}`,
  );
  // Only three bodies are retained at a time. Writes stay serial, with the existing
  // per-file transaction and live key/version checks; R2 reads overlap, D1 calls do not.
  for (let offset = 0; offset < jobs.length; offset += 3) {
    const wave = await Promise.all(jobs.slice(offset, offset + 3).map(async (e) => {
      try {
        const readable = e.index_mode === "content" && e.kind === "file" && e.size <= e.max_text_bytes &&
          /^(text\/|application\/(json|xml|javascript|x-yaml))/.test(e.content_type ?? "");
        e.reusable = e.reusable && readable ? 1 : 0;
        let content = "", verified = e.reusable;
        if (!e.reusable && readable) {
          const object = await requireResourceBindings("FILES_BUCKET").FILES_BUCKET.get(e.r2_key);
          if (object && object.size <= e.max_text_bytes) {
            content = await object.text();
            // Invalid UTF-8 expands to replacement characters when decoded. Bound
            // the stored UTF-8, not just R2's original bytes, before a D1 binding.
            // encodeInto never splits a code point; valid <=1 MiB text is intact.
            if (content.length > Math.floor(e.max_text_bytes / 3)) {
              const { read } = new TextEncoder().encodeInto(content, new Uint8Array(e.max_text_bytes));
              content = content.slice(0, read);
            }
            verified = 1;
          }
          else await object?.body?.cancel();
        }
        return { e, content, verified, failed: false as const };
      } catch (error) {
        return { e, error, failed: true as const };
      }
    }));
    for (const result of wave) {
      const { e } = result;
      try {
        if (result.failed) throw result.error;
        const policyGuard = sql`coalesce((SELECT revision FROM resource_policies WHERE owner_id=${e.owner_id}),0)=${e.policy_revision}
          AND NOT EXISTS(SELECT 1 FROM resource_policies WHERE owner_id=${e.owner_id} AND indexing_paused=1)
          AND EXISTS(SELECT 1 FROM resource_work WHERE kind='index' AND id=${e.id} AND generation=${e.job_generation})`;
        // Reuse text inside SQL, so even matching 1 MiB documents never cross D1
        // into the Worker. A tags-only placeholder (indexed_at=0) cannot be reused.
        await atomicBatch([
          sql`INSERT INTO search_documents(entry_id,object_key,content,indexed_at,content_verified)
            SELECT e.id,e.r2_key,CASE WHEN ${e.reusable}=1 THEN d.content ELSE ${result.content} END,${Date.now()},${result.verified}
            FROM entries e LEFT JOIN search_documents d ON d.entry_id=e.id AND d.object_key IS e.r2_key AND d.indexed_at>0 AND d.content_verified=1
            WHERE e.id=${e.id} AND e.owner_id=${e.owner_id} AND e.r2_key IS ${e.r2_key} AND (${e.reusable}=0 OR d.entry_id IS NOT NULL) AND ${policyGuard}
            ON CONFLICT(entry_id) DO UPDATE SET object_key=excluded.object_key,content=excluded.content,indexed_at=excluded.indexed_at,content_verified=excluded.content_verified`,
          sql`DELETE FROM file_search WHERE entry_id=${e.id} AND ${policyGuard}`,
          sql`INSERT INTO file_search(entry_id,name,content,tags) SELECT e.id,e.name,d.content,d.tags FROM entries e
            JOIN search_documents d ON d.entry_id=e.id AND d.object_key IS e.r2_key WHERE e.id=${e.id} AND e.owner_id=${e.owner_id} AND ${policyGuard}`,
          sql`DELETE FROM index_jobs WHERE entry_id=${e.id} AND EXISTS(SELECT 1 FROM entries e
            JOIN search_documents d ON d.entry_id=e.id AND d.object_key IS e.r2_key AND d.indexed_at>0
            WHERE e.id=${e.id} AND e.owner_id=${e.owner_id} AND e.r2_key IS ${e.r2_key} AND e.updated_at=${e.updated_at}) AND ${policyGuard}`,
        ]);
      } catch (error) {
        await rows(
          sql`UPDATE index_job_status SET attempts=attempts+1,last_error='Object could not be indexed',next_attempt=${Date.now() + 60000} WHERE entry_id=${e.id}
            AND EXISTS(SELECT 1 FROM resource_work WHERE kind='index' AND id=${e.id} AND generation=${e.job_generation})`,
        );
        if (entryId) throw error;
        console.error("Search indexing will retry", e.id, error instanceof Error ? error.name : "error");
      }
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
    kind?: "file" | "folder";
    minSize?: number;
    maxSize?: number;
    modifiedAfter?: number;
    modifiedBefore?: number;
    offset?: number;
    cursor?: string;
  },
) {
  const path = normalizeAgfsPath(input.path ?? auth.pathPrefix ?? "/");
  authorize(auth, "read", path);
  const terms = searchTerms(input.q);
  const scope = JSON.stringify([
    auth.user.id,
    path,
    input.q,
    input.type,
    input.tag,
    input.kind,
    input.minSize,
    input.maxSize,
    input.modifiedAfter,
    input.modifiedBefore,
  ]);
  const cursor = decodeCursor<{ path: string; scope: string }>(
    input.cursor,
    (v) => typeof v?.path === "string" && v.scope === scope,
  );
  const matches =
    await rows(sql`SELECT e.id,e.path,e.name,e.kind,e.size,e.content_type AS contentType,e.etag,
    e.updated_at AS updatedAt,d.tags,substr(d.content,1,240) AS excerpt,d.indexed_at AS indexedAt
    FROM entries e LEFT JOIN search_documents d ON d.entry_id=e.id AND d.object_key IS e.r2_key
    WHERE e.owner_id=${auth.user.id} AND ${pathRange(sql`e.path`, path, true)}
    AND (${input.kind ?? null} IS NULL OR e.kind=${input.kind ?? null})
    AND (${input.minSize ?? null} IS NULL OR coalesce(e.size,0)>=${input.minSize ?? null})
    AND (${input.maxSize ?? null} IS NULL OR coalesce(e.size,0)<=${input.maxSize ?? null})
    AND (${input.modifiedAfter ?? null} IS NULL OR e.updated_at>=${input.modifiedAfter ?? null})
    AND (${input.modifiedBefore ?? null} IS NULL OR e.updated_at<=${input.modifiedBefore ?? null})
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
