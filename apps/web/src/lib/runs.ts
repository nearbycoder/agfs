import { atomicBatch } from "./atomic-batch";
import { page, timeCursor } from "./cursor";
import { sql } from "drizzle-orm";
import { createAgfsId, normalizeAgfsPath } from "@agfs/db";
import { first, rows } from "./platform-db";
import type { RequestAuth } from "./authz";
import { authorize } from "./scope";
import { actorId } from "./workspaces";
import { errorResponse } from "./http";
import { requireResourceBindings } from "./bindings";
export async function createRun(
  auth: RequestAuth,
  input: {
    name: string;
    path: string;
    metadata: Record<string, string>;
    inputs: string[];
    retentionDays?: number;
  },
) {
  const path = normalizeAgfsPath(input.path);
  authorize(auth, "write", path);
  const inputs = [];
  for (const inputPath of input.inputs) {
    const normalized = normalizeAgfsPath(inputPath);
    authorize(auth, "read", normalized);
    const entry = await first(
      sql`SELECT path,size,etag,content_type,r2_key FROM entries WHERE owner_id=${auth.user.id} AND path=${normalized} AND kind='file'`,
    );
    if (!entry) throw errorResponse(404, "Input file not found");
    inputs.push(entry);
  }
  const id = createAgfsId("run");
  const at = Date.now(),
    expires = at + (input.retentionDays ?? 30) * 86400000;
  const guards = inputs.map(
    (e) =>
      sql`EXISTS(SELECT 1 FROM entries WHERE owner_id=${auth.user.id} AND path=${e.path} AND r2_key=${e.r2_key})`,
  );
  const result = await atomicBatch([
    sql`INSERT INTO agent_runs(id,owner_id,actor_id,token_id,name,path_prefix,metadata,created_at,inputs,retention_days) SELECT ${id},${auth.user.id},${actorId(auth)},${auth.tokenId ?? null},${input.name},${path},${JSON.stringify(input.metadata)},${at},${JSON.stringify(inputs)},${input.retentionDays ?? 30} WHERE ${guards.length ? sql.join(guards, sql` AND `) : sql`1`} RETURNING id`,
    ...inputs.map(
      (e) =>
        sql`INSERT OR IGNORE INTO run_artifacts SELECT ${id},${e.path},'input',${e.r2_key} WHERE EXISTS(SELECT 1 FROM agent_runs WHERE id=${id})`,
    ),
    ...inputs.map(
      (e) =>
        sql`INSERT OR IGNORE INTO object_pins SELECT ${auth.user.id},${id},${e.r2_key},${expires} WHERE EXISTS(SELECT 1 FROM agent_runs WHERE id=${id})`,
    ),
  ]);
  if (!result[0].results.length)
    throw errorResponse(409, "An input changed; retry starting the run");
  return { id, path, status: "running" };
}
export async function listRuns(auth: RequestAuth, cursor?: string) {
  const prefix = auth.pathPrefix ?? "/";
  authorize(auth, "read", prefix);
  const c = timeCursor(cursor);
  const result = page(
    await rows(sql`SELECT id,name,path_prefix,status,metadata,created_at,completed_at FROM agent_runs WHERE owner_id=${auth.user.id}
    AND (${prefix}='/' OR path_prefix=${prefix} OR substr(path_prefix,1,length(${prefix + "/"}))=${prefix + "/"}) AND (${c?.at ?? null} IS NULL OR created_at<${c?.at ?? 0} OR (created_at=${c?.at ?? 0} AND id<${c?.id ?? ""})) ORDER BY created_at DESC,id DESC LIMIT 51`),
  );
  return { runs: result.results, nextCursor: result.nextCursor };
}
export async function getRun(auth: RequestAuth, id: string) {
  const run = await first(
    sql`SELECT * FROM agent_runs WHERE id=${id} AND owner_id=${auth.user.id}`,
  );
  if (!run) throw errorResponse(404, "Run not found");
  authorize(auth, "read", run.path_prefix);
  for (const input of JSON.parse(run.inputs))
    authorize(auth, "read", input.path);
  return run;
}
export async function finishRun(auth: RequestAuth, id: string) {
  const run = await getRun(auth, id);
  authorize(auth, "write", run.path_prefix);
  if (run.status === "completed") return { manifest: JSON.parse(run.manifest) };
  const prefix = run.path_prefix === "/" ? "/" : run.path_prefix + "/";
  const artifacts =
    await rows(sql`SELECT path,size,etag,content_type,r2_key,updated_at FROM entries WHERE owner_id=${auth.user.id} AND kind='file'
    AND (path=${run.path_prefix} OR substr(path,1,length(${prefix}))=${prefix}) ORDER BY path LIMIT 201`);
  if (artifacts.length > 200)
    throw errorResponse(
      409,
      "A run manifest supports at most 200 artifacts; use a narrower folder",
    );
  const manifest = {
    version: 1,
    runId: id,
    name: run.name,
    actorId: run.actor_id,
    tokenId: run.token_id,
    metadata: JSON.parse(run.metadata),
    inputs: JSON.parse(run.inputs).map(({ r2_key, ...v }: any) => v),
    retainedUntil: new Date(
      Date.now() + run.retention_days * 86400000,
    ).toISOString(),
    completedAt: new Date().toISOString(),
    artifacts: [] as Record<string, unknown>[],
  };
  for (const a of artifacts) {
    const object = await requireResourceBindings(
      "FILES_BUCKET",
    ).FILES_BUCKET.head(a.r2_key);
    if (!object || object.etag !== a.etag)
      throw errorResponse(409, "An artifact changed; retry completing the run");
    manifest.artifacts.push({
      path: a.path,
      size: a.size,
      etag: a.etag,
      contentType: a.content_type,
      updatedAt: a.updated_at,
      checksum: object.checksums.sha256
        ? Array.from(new Uint8Array(object.checksums.sha256))
            .map((b) => b.toString(16).padStart(2, "0"))
            .join("")
        : null,
    });
  }
  const until = Date.now() + run.retention_days * 86400000;
  const guards = artifacts.map(
    (e) =>
      sql`EXISTS(SELECT 1 FROM entries WHERE owner_id=${auth.user.id} AND path=${e.path} AND r2_key=${e.r2_key})`,
  );
  const all = [...JSON.parse(run.inputs), ...artifacts];
  const stillAvailable = all
    .filter((e) => e.r2_key)
    .map(
      (e) =>
        sql`(EXISTS(SELECT 1 FROM entries WHERE r2_key=${e.r2_key}) OR EXISTS(SELECT 1 FROM object_pins WHERE reference_id=${id} AND object_key=${e.r2_key} AND expires_at>${Date.now()}))`,
    );
  const result = await atomicBatch([
    sql`UPDATE agent_runs SET status='completed',manifest=${JSON.stringify(manifest)},completed_at=${Date.now()} WHERE id=${id} AND status='running' AND ${guards.length ? sql.join(guards, sql` AND `) : sql`1`} AND ${stillAvailable.length ? sql.join(stillAvailable, sql` AND `) : sql`1`} RETURNING manifest`,
    ...artifacts.map(
      (e) =>
        sql`INSERT OR IGNORE INTO run_artifacts SELECT ${id},${e.path},'output',${e.r2_key} WHERE EXISTS(SELECT 1 FROM agent_runs WHERE id=${id} AND manifest=${JSON.stringify(manifest)})`,
    ),
    ...all
      .filter((e) => e.r2_key)
      .map(
        (e) =>
          sql`INSERT INTO object_pins SELECT ${auth.user.id},${id},${e.r2_key},${until} WHERE EXISTS(SELECT 1 FROM agent_runs WHERE id=${id} AND manifest=${JSON.stringify(manifest)}) ON CONFLICT(reference_id,object_key) DO UPDATE SET expires_at=excluded.expires_at`,
      ),
  ]);
  const saved = result[0].results[0] as any;
  if (!saved && (await getRun(auth, id)).status !== "completed")
    throw errorResponse(
      409,
      "Run files changed or expired; retry with available inputs",
    );

  return {
    manifest: saved
      ? JSON.parse(saved.manifest)
      : JSON.parse((await getRun(auth, id)).manifest),
  };
}
