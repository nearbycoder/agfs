import { sql } from "drizzle-orm";
import { z } from "zod";
import type { RequestAuth } from "./authz";
import { authorize } from "./scope";
import { actorId } from "./workspaces";
import { rows } from "./platform-db";
import { json, parseJson, errorResponse } from "./http";
export async function recordRecentFile(auth: RequestAuth, entryId: string) {
  if (auth.authSource !== "session") return;
  const owner = auth.user.id,
    actor = actorId(auth);
  try {
    await rows(
      sql`INSERT INTO recent_files(owner_id,actor_id,entry_id,opened_at) SELECT ${owner},${actor},id,${Date.now()} FROM entries WHERE id=${entryId} AND owner_id=${owner} AND kind='file' ON CONFLICT(owner_id,actor_id,entry_id) DO UPDATE SET opened_at=excluded.opened_at`,
    );
    await rows(
      sql`DELETE FROM recent_files WHERE owner_id=${owner} AND actor_id=${actor} AND entry_id NOT IN (SELECT entry_id FROM recent_files WHERE owner_id=${owner} AND actor_id=${actor} ORDER BY opened_at DESC,entry_id LIMIT 100)`,
    );
  } catch {
    console.error("Could not record recent file");
  }
}
export async function recentFilesApi(
  request: Request,
  auth: RequestAuth,
  route: string,
): Promise<Response | null> {
  if (route !== "/recent-files") return null;
  if (auth.authSource !== "session")
    throw errorResponse(403, "Recent files are personal browser history");
  authorize(auth, "read");
  const owner = auth.user.id,
    actor = actorId(auth);
  if (request.method === "GET")
    return json({
      recent: await rows(
        sql`SELECT e.id,e.path,e.size,e.content_type AS contentType,r.opened_at AS openedAt FROM recent_files r JOIN entries e ON e.id=r.entry_id AND e.owner_id=r.owner_id WHERE r.owner_id=${owner} AND r.actor_id=${actor} AND e.kind='file' ORDER BY r.opened_at DESC,e.id LIMIT 100`,
      ),
    });
  if (request.method === "DELETE") {
    const input = await parseJson(
      request,
      z.union([
        z.object({ entryId: z.string().min(1).max(128) }),
        z.object({ clear: z.literal(true) }),
      ]),
    );
    if ("entryId" in input)
      await rows(
        sql`DELETE FROM recent_files WHERE owner_id=${owner} AND actor_id=${actor} AND entry_id=${input.entryId}`,
      );
    else
      await rows(
        sql`DELETE FROM recent_files WHERE owner_id=${owner} AND actor_id=${actor}`,
      );
    return json({ ok: true });
  }
  return null;
}
