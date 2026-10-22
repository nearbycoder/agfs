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
  const paths = input.inputs.map(normalizeAgfsPath);
  for (const inputPath of paths) authorize(auth, "read", inputPath);
  // json_each preserves caller order and duplicate inputs without growing the
  // number of bound parameters with the (up to 50) input paths.
  const inputs = paths.length
    ? await rows(sql`SELECT e.path,e.size,e.etag,e.content_type,e.r2_key
        FROM json_each(${JSON.stringify(paths)}) i JOIN entries e
          ON e.owner_id=${auth.user.id} AND e.path=i.value AND e.kind='file'
        ORDER BY i.key`)
    : [];
  if (inputs.length !== paths.length) throw errorResponse(404, "Input file not found");
  const id = createAgfsId("run");
  const at = Date.now(),
    expires = at + (input.retentionDays ?? 30) * 86400000;
  const encodedInputs = JSON.stringify(inputs);
  const unchanged = sql`NOT EXISTS(SELECT 1 FROM json_each(${encodedInputs}) i
    WHERE NOT EXISTS(SELECT 1 FROM entries e WHERE e.owner_id=${auth.user.id}
      AND e.path=json_extract(i.value,'$.path') AND e.r2_key=json_extract(i.value,'$.r2_key')))`;
  const result = await atomicBatch([
    sql`INSERT INTO agent_runs(id,owner_id,actor_id,token_id,name,path_prefix,metadata,created_at,inputs,retention_days) SELECT ${id},${auth.user.id},${actorId(auth)},${auth.tokenId ?? null},${input.name},${path},${JSON.stringify(input.metadata)},${at},${encodedInputs},${input.retentionDays ?? 30} WHERE ${unchanged} RETURNING id`,
    sql`INSERT OR IGNORE INTO run_artifacts
      SELECT r.id,json_extract(i.value,'$.path'),'input',json_extract(i.value,'$.r2_key')
      FROM agent_runs r,json_each(r.inputs) i WHERE r.id=${id}`,
    sql`INSERT OR IGNORE INTO object_pins
      SELECT r.owner_id,r.id,json_extract(i.value,'$.r2_key'),${expires}
      FROM agent_runs r,json_each(r.inputs) i WHERE r.id=${id}`,
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
  const verifiedArtifacts: Record<string, unknown>[] = [];
  for (const a of artifacts) {
    const object = await requireResourceBindings(
      "FILES_BUCKET",
    ).FILES_BUCKET.head(a.r2_key);
    if (!object || object.etag !== a.etag)
      throw errorResponse(409, "An artifact changed; retry completing the run");
    verifiedArtifacts.push({
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
  // Use one timestamp after R2 verification for both the manifest and its pins.
  const at = Date.now(), until = at + run.retention_days * 86400000;
  const inputs = JSON.parse(run.inputs);
  const manifest = {
    version: 1,
    runId: id,
    name: run.name,
    actorId: run.actor_id,
    tokenId: run.token_id,
    metadata: JSON.parse(run.metadata),
    inputs: inputs.map(({ r2_key, ...v }: any) => v),
    retainedUntil: new Date(until).toISOString(),
    completedAt: new Date(at).toISOString(),
    artifacts: verifiedArtifacts,
  };
  const encodedManifest = JSON.stringify(manifest);
  const encodedArtifacts = JSON.stringify(artifacts);
  const keys = JSON.stringify([...new Set(
    [...inputs, ...artifacts].map((e) => e.r2_key).filter(Boolean),
  )]);
  // The database clock also covers expiry while the batch waits to execute.
  const availableAt = sql`max(${at}, CAST(round((julianday('now') - 2440587.5) * 86400000) AS INTEGER))`;
  const result = await atomicBatch([
    // Bound JSON keeps the parameter count fixed for 50 inputs and 200 outputs.
    // Count plus null-safe membership checks reject additions and metadata races.
    sql`WITH captured AS (SELECT value FROM json_each(${encodedArtifacts})),
      live AS (SELECT path,size,etag,content_type,r2_key,updated_at FROM entries
        WHERE owner_id=${auth.user.id} AND kind='file'
        AND (path=${run.path_prefix} OR substr(path,1,length(${prefix}))=${prefix}) LIMIT 201)
      UPDATE agent_runs SET status='completed',manifest=${encodedManifest},completed_at=${at}
      WHERE id=${id} AND owner_id=${auth.user.id} AND status='running'
        AND path_prefix=${run.path_prefix} AND inputs=${run.inputs} AND retention_days=${run.retention_days}
        AND (SELECT count(*) FROM live)=(SELECT count(*) FROM captured)
        AND NOT EXISTS(SELECT 1 FROM captured c WHERE NOT EXISTS(SELECT 1 FROM live e
          WHERE e.path=json_extract(c.value,'$.path') AND e.r2_key=json_extract(c.value,'$.r2_key')
            AND e.size IS json_extract(c.value,'$.size') AND e.etag IS json_extract(c.value,'$.etag')
            AND e.content_type IS json_extract(c.value,'$.content_type')
            AND e.updated_at IS json_extract(c.value,'$.updated_at')))
        AND NOT EXISTS(SELECT 1 FROM json_each(${keys}) k
          WHERE NOT EXISTS(SELECT 1 FROM entries e WHERE e.owner_id=${auth.user.id} AND e.kind='file' AND e.r2_key=k.value)
            AND NOT EXISTS(SELECT 1 FROM object_pins p WHERE p.owner_id=${auth.user.id}
              AND p.reference_id=${id} AND p.object_key=k.value AND p.expires_at>${availableAt}))
        AND NOT EXISTS(SELECT 1 FROM object_pins WHERE reference_id=${id} AND owner_id<>${auth.user.id})
      RETURNING manifest`,
    sql`INSERT OR IGNORE INTO run_artifacts
      SELECT r.id,json_extract(a.value,'$.path'),'output',json_extract(a.value,'$.r2_key')
      FROM agent_runs r,json_each(${encodedArtifacts}) a
      WHERE r.id=${id} AND r.owner_id=${auth.user.id} AND r.status='completed' AND r.manifest=${encodedManifest}`,
    // Pin the persisted winner's keys, including if two attempts produce the
    // same public manifest but captured different internal object keys.
    sql`INSERT INTO object_pins
      SELECT DISTINCT r.owner_id,r.id,a.object_key,${until}
      FROM agent_runs r JOIN run_artifacts a ON a.run_id=r.id
      WHERE r.id=${id} AND r.owner_id=${auth.user.id} AND r.status='completed' AND r.manifest=${encodedManifest}
      ON CONFLICT(reference_id,object_key) DO UPDATE SET expires_at=excluded.expires_at
      WHERE object_pins.owner_id=excluded.owner_id`,
  ]);
  const saved = result[0].results[0] as any;
  if (saved) return { manifest: JSON.parse(saved.manifest) };
  const latest = await getRun(auth, id);
  if (latest.status !== "completed")
    throw errorResponse(
      409,
      "Run files changed or expired; retry with available inputs",
    );

  return { manifest: JSON.parse(latest.manifest) };
}
