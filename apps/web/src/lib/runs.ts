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
  },
) {
  const path = normalizeAgfsPath(input.path);
  authorize(auth, "write", path);
  const inputs = [];
  for (const inputPath of input.inputs) {
    const normalized = normalizeAgfsPath(inputPath);
    authorize(auth, "read", normalized);
    const entry = await first(
      sql`SELECT path,size,etag,content_type FROM entries WHERE owner_id=${auth.user.id} AND path=${normalized} AND kind='file'`,
    );
    if (!entry) throw errorResponse(404, "Input file not found");
    inputs.push(entry);
  }
  const id = createAgfsId("run");
  await rows(sql`INSERT INTO agent_runs(id,owner_id,actor_id,token_id,name,path_prefix,metadata,created_at,inputs)
    VALUES (${id},${auth.user.id},${actorId(auth)},${auth.tokenId ?? null},${input.name},${path},${JSON.stringify(input.metadata)},${Date.now()},${JSON.stringify(inputs)})`);
  return { id, path, status: "running" };
}
export async function listRuns(auth: RequestAuth) {
  const prefix = auth.pathPrefix ?? "/";
  authorize(auth, "read", prefix);
  return rows(sql`SELECT id,name,path_prefix,status,metadata,created_at,completed_at FROM agent_runs WHERE owner_id=${auth.user.id}
    AND (${prefix}='/' OR path_prefix=${prefix} OR substr(path_prefix,1,length(${prefix + "/"}))=${prefix + "/"}) ORDER BY created_at DESC LIMIT 100`);
}
export async function getRun(auth: RequestAuth, id: string) {
  const run = await first(
    sql`SELECT * FROM agent_runs WHERE id=${id} AND owner_id=${auth.user.id}`,
  );
  if (!run) throw errorResponse(404, "Run not found");
  authorize(auth, "read", run.path_prefix);
  for(const input of JSON.parse(run.inputs)) authorize(auth,"read",input.path);
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
    inputs: JSON.parse(run.inputs),
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
  const saved =
    await first(sql`UPDATE agent_runs SET status='completed',manifest=${JSON.stringify(manifest)},completed_at=${Date.now()}
    WHERE id=${id} AND status='running' RETURNING manifest`);
  return {
    manifest: saved
      ? JSON.parse(saved.manifest)
      : JSON.parse((await getRun(auth, id)).manifest),
  };
}
