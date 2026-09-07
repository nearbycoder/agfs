import { sql } from "drizzle-orm";
import { z } from "zod";
import { pathSchema } from "@agfs/contracts";
import type { RequestAuth } from "./authz";
import { authorize } from "./scope";
import { actorId } from "./workspaces";
import { rows, first } from "./platform-db";
import { json, parseJson, errorResponse } from "./http";

export async function libraryApi(
  request: Request,
  auth: RequestAuth,
  path: string,
): Promise<Response | null> {
  if (path !== "/favorites") return null;
  if (auth.authSource !== "session")
    throw errorResponse(403, "Favorites are personal browser preferences");
  authorize(auth, "read");
  const owner = auth.user.id,
    actor = actorId(auth);
  if (request.method === "GET")
    return json({
      favorites: await rows(sql`
    SELECT e.id,e.path,e.kind,e.size,e.updated_at AS updatedAt,f.created_at AS favoritedAt
    FROM favorites f JOIN entries e ON e.id=f.entry_id AND e.owner_id=f.owner_id
    WHERE f.owner_id=${owner} AND f.actor_id=${actor} ORDER BY f.created_at DESC,e.path LIMIT 200`),
    });
  if (request.method === "PUT" || request.method === "DELETE") {
    const input = await parseJson(request, z.object({ path: pathSchema }));
    authorize(auth, "read", input.path);
    const entry = await first(
      sql`SELECT id FROM entries WHERE owner_id=${owner} AND path=${input.path}`,
    );
    if (!entry) throw errorResponse(404, "File or folder not found");
    if (request.method === "DELETE")
      await rows(
        sql`DELETE FROM favorites WHERE owner_id=${owner} AND actor_id=${actor} AND entry_id=${entry.id}`,
      );
    else {
      const result =
        await rows(sql`INSERT INTO favorites SELECT ${owner},${actor},${entry.id},${Date.now()}
        WHERE (SELECT count(*) FROM favorites WHERE owner_id=${owner} AND actor_id=${actor})<200
        ON CONFLICT(owner_id,actor_id,entry_id) DO UPDATE SET created_at=excluded.created_at RETURNING entry_id`);
      if (
        !result.length &&
        !(await first(
          sql`SELECT 1 FROM favorites WHERE owner_id=${owner} AND actor_id=${actor} AND entry_id=${entry.id}`,
        ))
      )
        throw errorResponse(
          409,
          "Remove a favorite before adding more (limit 200)",
        );
    }
    return json({ ok: true });
  }
  return null;
}
