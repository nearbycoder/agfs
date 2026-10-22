import { createHmac, timingSafeEqual } from "node:crypto";
import { sql } from "drizzle-orm";
import { hashSecret } from "@agfs/db";
import type { ReindexPlanResult } from "@agfs/contracts";
import type { RequestAuth } from "./authz";
import { requireStringBindings } from "./bindings";
import { first } from "./platform-db";
import { atomicBatch } from "./atomic-batch";
import { pathRange } from "./path-range";
import { resourcePath, resourceCursor, resourcePage } from "./resource-controls";
import { errorResponse } from "./http";

type Review = { v: 1; scope: string; page: string; expiresAt: number };
const changed = () => errorResponse(409, "Reindex review changed or expired; refresh and review before applying");
function signature(payload: string) {
  return createHmac("sha256", requireStringBindings("BETTER_AUTH_SECRET").BETTER_AUTH_SECRET)
    .update("agfs:operations:reindex:v1:" + payload).digest();
}
function reviewToken(review: Review) {
  const payload = Buffer.from(JSON.stringify(review)).toString("base64url");
  return payload + "." + signature(payload).toString("base64url");
}
function verifyReview(token: string | undefined, scope: string): Review {
  if (!token || token.length > 512) throw changed();
  const [payload, signed, extra] = token.split(".");
  if (!payload || !signed || extra !== undefined || !/^[A-Za-z0-9_-]+$/.test(payload + signed)) throw changed();
  const supplied = Buffer.from(signed, "base64url"), expected = signature(payload);
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) throw changed();
  let review: Review;
  try { review = JSON.parse(Buffer.from(payload, "base64url").toString()); } catch { throw changed(); }
  if (review.v !== 1 || review.scope !== scope || !Number.isSafeInteger(review.expiresAt) || review.expiresAt <= Date.now() ||
    typeof review.page !== "string" || !/^[a-f0-9]{64}$/.test(review.page)) throw changed();
  return review;
}

export async function reindexPlan(auth: RequestAuth, input: { path: string; failedOnly: boolean; dryRun: boolean; cursor?: string; reviewToken?: string }): Promise<ReindexPlanResult> {
  const path = resourcePath(auth, input.path), { key, value } = resourceCursor(input.cursor, [auth.user.id, "reindex", path, input.failedOnly], path);
  const scope = hashSecret(JSON.stringify([key, input.cursor ?? ""]));
  // Authorize and verify the submitted review before any candidate reads.
  const reviewed = input.dryRun ? null : verifyReview(input.reviewToken, scope);
  // The same bounded snapshot expression is evaluated again INSIDE the apply
  // transaction. It covers all 51 candidates (including the continuation sentinel),
  // source metadata, retry/generation state, cache eligibility, and current policy.
  // Neither raw object keys nor signing material is included in the response token.
  const snapshotQuery = sql`WITH candidates AS MATERIALIZED (
    SELECT e.id,e.path,e.kind,e.size,e.content_type,e.r2_key,e.etag,e.updated_at,
      coalesce(s.attempts,0) AS attempts,s.queued_at,s.next_attempt,w.generation,
      d.object_key,d.indexed_at,d.content_verified
    FROM entries e LEFT JOIN index_job_status s ON s.entry_id=e.id
    LEFT JOIN resource_work w ON w.kind='index' AND w.id=e.id
    LEFT JOIN search_documents d ON d.entry_id=e.id
    WHERE e.owner_id=${auth.user.id} AND ${pathRange(sql`e.path`, path, true)} AND e.path>${value?.after ?? ""}
    ORDER BY e.path LIMIT 51)
    SELECT json_array(
      json(coalesce((SELECT json_array(revision,index_mode,max_text_bytes,indexing_paused) FROM resource_policies WHERE owner_id=${auth.user.id}),'[0,"content",1048576,0]')),
      json((SELECT json_group_array(json_object('id',id,'path',path,'kind',kind,'size',size,'contentType',content_type,
        'objectKey',r2_key,'etag',etag,'updatedAt',updated_at,'attempts',attempts,'queuedAt',queued_at,'nextAttempt',next_attempt,
        'generation',generation,'cachedKey',object_key,'indexedAt',indexed_at,'contentVerified',content_verified))
        FROM (SELECT * FROM candidates ORDER BY path)))
    ) AS snapshot`;
  const snapshot = (await first(snapshotQuery))!.snapshot as string;
  const digest = hashSecret(snapshot);
  if (reviewed && digest !== reviewed.page) throw changed();
  const candidates = (JSON.parse(snapshot) as [unknown, Array<{ id: string; path: string; attempts: number }>])[1];
  const page = resourcePage(candidates, key, (last) => ({ after: last.path }), path);
  const selected = page.results.filter((e) => !input.failedOnly || e.attempts > 0).map(({ id, path, attempts }) => ({ id, path, attempts }));
  let enqueued = 0;
  if (reviewed) {
    const ids = JSON.stringify(selected.map((e) => e.id)), guard = hashSecret(input.reviewToken!);
    try {
      const result = await atomicBatch([
        sql`INSERT INTO resource_reindex_guard(id,valid) SELECT ${guard},CASE WHEN (${snapshotQuery})=${snapshot}
          AND unixepoch()*1000<${reviewed.expiresAt} THEN 1 ELSE 0 END`,
        sql`INSERT INTO index_jobs(entry_id) SELECT e.id FROM json_each(${ids}) ids JOIN entries e ON e.id=ids.value
          WHERE e.owner_id=${auth.user.id} AND ${pathRange(sql`e.path`, path, true)} ON CONFLICT(entry_id) DO NOTHING`,
        sql`UPDATE index_job_status SET attempts=0,last_error=NULL,next_attempt=0 WHERE entry_id IN
          (SELECT e.id FROM json_each(${ids}) ids JOIN entries e ON e.id=ids.value WHERE e.owner_id=${auth.user.id} AND ${pathRange(sql`e.path`, path, true)}) RETURNING entry_id`,
        sql`DELETE FROM resource_reindex_guard WHERE id=${guard}`,
      ]);
      enqueued = result[2].results.length;
    } catch (error) {
      if (error instanceof Error && error.message.includes("resource_reindex_review")) throw changed();
      throw error;
    }
  }
  const expiresAt = Math.floor(Date.now() / 1000) * 1000 + 300_000;
  return { results: selected, nextCursor: page.nextCursor, inspected: page.results.length, dryRun: input.dryRun, enqueued,
    maximumR2Reads: selected.length, reviewToken: input.dryRun ? reviewToken({ v: 1, scope, page: digest, expiresAt }) : null,
    reviewExpiresAt: input.dryRun ? expiresAt : null };
}
