import { z } from "zod";
import { sql } from "drizzle-orm";
import { pathSchema } from "@agfs/contracts";
import { createAgfsId } from "@agfs/db";
import { json, parseJson, errorResponse } from "./http";
import { rows, first } from "./platform-db";
import { authorize } from "./scope";
import { actorId, requireWorkspaceOwner } from "./workspaces";
import type { RequestAuth } from "./authz";
import * as snapshots from "./snapshots";
import * as admin from "./workspace-admin";
import { changes } from "./changes";
const name = z.string().trim().min(1).max(100),
  cursor = z.string().max(4096).optional();
export async function reliabilityApi(
  request: Request,
  auth: RequestAuth,
  path: string,
): Promise<Response | null> {
  const method = request.method,
    url = new URL(request.url),
    query = Object.fromEntries(url.searchParams);
  if (path === "/changes" && method === "GET")
    return json(
      await changes(
        auth,
        z
          .object({
            path: pathSchema.optional(),
            since: z.coerce.number().int().min(0).optional(),
            through: z.coerce.number().int().min(0).optional(),
          })
          .parse(query),
      ),
    );
  if (path === "/snapshots") {
    if (method === "GET")
      return json(
        await snapshots.listSnapshots(
          auth,
          z.object({ cursor }).parse(query).cursor,
        ),
      );
    if (method === "POST")
      return json(
        await snapshots.createSnapshot(
          auth,
          await parseJson(
            request,
            z.object({
              name,
              path: pathSchema,
              days: z.number().int().min(1).max(90).default(30),
            }),
          ),
        ),
        { status: 201 },
      );
  }
  const runFile = /^\/runs\/([\w-]+)\/file$/.exec(path);
  if (runFile && method === "GET") {
    await (await import("./runs")).getRun(auth, runFile[1]);
    const v = z
      .object({
        path: pathSchema,
        kind: z.enum(["input", "output"]).default("output"),
      })
      .parse(query);
    authorize(auth, "read", v.path);
    const row = await first(
      sql`SELECT a.object_key FROM run_artifacts a JOIN object_pins p ON p.reference_id=a.run_id AND p.object_key=a.object_key WHERE a.run_id=${runFile[1]} AND a.path=${v.path} AND a.kind=${v.kind} AND p.owner_id=${auth.user.id} AND p.expires_at>${Date.now()}`,
    );
    if (!row)
      throw errorResponse(404, "Run file is unavailable or retention expired");
    return (await import("./r2")).streamObject(row.object_key);
  }
  const snap = /^\/snapshots\/([\w-]+)(?:\/(restore|manifest|file))?$/.exec(
    path,
  );
  if (snap) {
    if (method === "DELETE" && !snap[2])
      return json(await snapshots.deleteSnapshot(auth, snap[1]));
    if (method === "POST" && snap[2] === "restore")
      return json(await snapshots.restoreSnapshot(auth, snap[1]));
    if (method === "GET" && snap[2] === "manifest")
      return json(
        await snapshots.snapshotManifest(
          auth,
          snap[1],
          z.object({ cursor }).parse(query).cursor,
        ),
      );
    if (method === "GET" && snap[2] === "file") {
      await snapshots.snapshot(auth, snap[1]);
      const p = pathSchema.parse(query.path);
      const e = await first(
        sql`SELECT entry FROM snapshot_entries WHERE snapshot_id=${snap[1]} AND path=${p}`,
      );
      if (!e) throw errorResponse(404, "Snapshot file not found");
      const v = JSON.parse(e.entry);
      if (!v.r2_key) throw errorResponse(400, "Not a file");
      return (await import("./r2")).streamObject(v.r2_key);
    }
  }
  if (path === "/health" && method === "GET")
    return json(await (await import("./operations")).health(auth));
  if (path === "/health/thresholds" && method === "PUT") {
    authorize(auth, "manage");
    const v = await parseJson(
      request,
      z.object({
        errorPercent: z.number().int().min(1).max(100),
        backlog: z.number().int().min(1).max(100000),
        latencyMs: z.number().int().min(100).max(60000),
      }),
    );
    await rows(
      sql`INSERT INTO health_thresholds VALUES(${auth.user.id},${v.errorPercent},${v.backlog},${v.latencyMs}) ON CONFLICT(owner_id) DO UPDATE SET error_percent=excluded.error_percent,backlog=excluded.backlog,latency_ms=excluded.latency_ms`,
    );
    return json({ ok: true });
  }
  if (path === "/search/reindex" && method === "POST") {
    authorize(auth, "manage");
    await (
      await import("./atomic-batch")
    ).atomicBatch([
      sql`INSERT INTO index_jobs(entry_id) SELECT id FROM entries WHERE owner_id=${auth.user.id} ON CONFLICT(entry_id) DO NOTHING`,
      sql`UPDATE index_job_status SET attempts=0,last_error=NULL,next_attempt=0 WHERE entry_id IN (SELECT id FROM entries WHERE owner_id=${auth.user.id})`,
    ]);
    return json({ ok: true });
  }
  const rotation = /^\/(tokens|webhooks)\/([\w-]+)\/rotate$/.exec(path);
  if (rotation && method === "POST") {
    const c = await import("./credentials");
    return json(
      await (rotation[1] === "tokens" ? c.rotateToken : c.rotateWebhook)(
        auth,
        rotation[2],
      ),
    );
  }
  if (path === "/invites" && method === "GET")
    return json({
      invites: await admin.invites(auth),
      emailConfigured: !!(await import("./bindings")).getBindings()
        .RESEND_API_KEY,
    });
  const invite = /^\/invites\/([\w-]+)$/.exec(path);
  if (invite && method === "DELETE")
    return json(await admin.revokeInvite(auth, invite[1]));
  if (path === "/ownership") {
    if (method === "GET") return json(await admin.transferStatus(auth));
    if (method === "POST")
      return json(
        await admin.proposeTransfer(
          auth,
          (
            await parseJson(
              request,
              z.object({ userId: z.string().min(1).max(128) }),
            )
          ).userId,
        ),
      );
    if (method === "DELETE") {
      await requireWorkspaceOwner(auth);
      await rows(
        sql`DELETE FROM ownership_transfers WHERE workspace_id=${auth.workspaceId}`,
      );
      return json({ ok: true });
    }
  }
  if (path === "/ownership/accept" && method === "POST")
    return json(await admin.acceptTransfer(auth));
  if (path === "/review-policy") {
    if (method === "GET") {
      await requireWorkspaceOwner(auth);
      return json(
        await first(
          sql`SELECT independent_review FROM workspaces WHERE id=${auth.workspaceId}`,
        ),
      );
    }
    if (method === "PUT") {
      await requireWorkspaceOwner(auth);
      const v = await parseJson(
        request,
        z.object({ independentReview: z.boolean() }),
      );
      await rows(
        sql`UPDATE workspaces SET independent_review=${v.independentReview ? 1 : 0} WHERE id=${auth.workspaceId}`,
      );
      return json({ ok: true });
    }
  }
  const draft =
    /^\/drafts\/([\w-]+)\/(comments|request-changes|resubmit)$/.exec(path);
  if (draft && method === "POST") {
    const item = await (await import("./drafts")).draft(auth, draft[1]);
    if (draft[2] === "comments") {
      const v = await parseJson(
        request,
        z.object({
          body: z.string().trim().min(1).max(4000),
          path: pathSchema.optional(),
          line: z.number().int().min(1).max(100000).optional(),
        }),
      );
      if (
        v.path &&
        !(await first(
          sql`SELECT path FROM draft_changes WHERE draft_id=${item.id} AND path=${v.path}`,
        ))
      )
        throw errorResponse(400, "Comment path must belong to the draft");
      authorize(auth, "read", v.path ?? item.path_prefix);
      const result = await rows(
        sql`INSERT INTO draft_comments SELECT ${createAgfsId("comment")},${item.id},${actorId(auth)},${v.body},${v.path ?? null},${v.line ?? null},${Date.now()} WHERE (SELECT count(*) FROM draft_comments WHERE draft_id=${item.id})<200 RETURNING id`,
      );
      if (!result.length)
        throw errorResponse(409, "Draft comment limit reached");
      return json({ id: result[0].id });
    }
    if (draft[2] === "request-changes") {
      await (await import("./drafts")).requireDraftReviewer(auth, item);
      if (auth.authSource !== "session")
        throw errorResponse(403, "A person must review changes");
      const v = await parseJson(
        request,
        z.object({ body: z.string().trim().min(1).max(4000) }),
      );
      const result = await (
        await import("./atomic-batch")
      ).atomicBatch([
        sql`INSERT INTO draft_comments SELECT ${createAgfsId("comment")},id,${actorId(auth)},${v.body},NULL,NULL,${Date.now()} FROM draft_sets WHERE id=${item.id} AND status='open'`,
        sql`UPDATE draft_sets SET status='changes_requested',reviewed_by=${actorId(auth)},reviewed_at=${Date.now()} WHERE id=${item.id} AND status='open' RETURNING id`,
      ]);
      if (!result[1].results.length)
        throw errorResponse(409, "Draft is no longer open");
      return json({ ok: true });
    }
    if (item.actor_id !== actorId(auth))
      throw errorResponse(403, "Only the draft author can resubmit");
    const result = await rows(
      sql`UPDATE draft_sets SET status='open',reviewed_by=NULL,reviewed_at=NULL WHERE id=${item.id} AND status='changes_requested' RETURNING id`,
    );
    if (!result.length)
      throw errorResponse(409, "Draft has no requested changes");
    return json({ ok: true });
  }
  return null;
}
