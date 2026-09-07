import { sql } from "drizzle-orm";
import { z } from "zod";
import { pathSchema } from "@agfs/contracts";
import { createAgfsId } from "@agfs/db";
import type { RequestAuth } from "./authz";
import { authorize } from "./scope";
import { actorId } from "./workspaces";
import { rows, first } from "./platform-db";
import { json, parseJson, errorResponse } from "./http";
const name = z.string().trim().min(1).max(100);
export async function collectionsApi(
  request: Request,
  auth: RequestAuth,
  path: string,
): Promise<Response | null> {
  const match = /^\/collections(?:\/([\w-]+)(?:\/(items))?)?$/.exec(path);
  if (!match) return null;
  if (auth.authSource !== "session")
    throw errorResponse(403, "Collections are personal browser preferences");
  authorize(auth, "read");
  const owner = auth.user.id,
    actor = actorId(auth),
    id = match[1],
    items = match[2];
  if (!id) {
    if (request.method === "GET")
      return json({
        collections: await rows(
          sql`SELECT c.id,c.name,c.created_at AS createdAt,(SELECT count(*) FROM collection_entries i WHERE i.collection_id=c.id) AS count FROM collections c WHERE c.owner_id=${owner} AND c.actor_id=${actor} ORDER BY c.name LIMIT 50`,
        ),
      });
    if (request.method === "POST") {
      const input = await parseJson(request, z.object({ name }));
      const result = await rows(
        sql`INSERT INTO collections SELECT ${createAgfsId("collection")},${owner},${actor},${input.name},${Date.now()} WHERE (SELECT count(*) FROM collections WHERE owner_id=${owner} AND actor_id=${actor})<50 AND NOT EXISTS(SELECT 1 FROM collections WHERE owner_id=${owner} AND actor_id=${actor} AND name=${input.name}) RETURNING id`,
      );
      if (!result.length)
        throw errorResponse(
          409,
          "Use a unique name and keep at most 50 collections",
        );
      return json(result[0], { status: 201 });
    }
  } else {
    if (
      !(await first(
        sql`SELECT id FROM collections WHERE id=${id} AND owner_id=${owner} AND actor_id=${actor}`,
      ))
    )
      throw errorResponse(404, "Collection not found");
    if (!items) {
      if (request.method === "DELETE") {
        await rows(
          sql`DELETE FROM collections WHERE id=${id} AND owner_id=${owner} AND actor_id=${actor}`,
        );
        return json({ ok: true });
      }
      if (request.method === "PATCH") {
        const input = await parseJson(request, z.object({ name }));
        const result = await rows(
          sql`UPDATE collections SET name=${input.name} WHERE id=${id} AND owner_id=${owner} AND actor_id=${actor} AND NOT EXISTS(SELECT 1 FROM collections WHERE owner_id=${owner} AND actor_id=${actor} AND name=${input.name} AND id!=${id}) RETURNING id`,
        );
        if (!result.length)
          throw errorResponse(409, "Collection name already exists");
        return json({ ok: true });
      }
    } else {
      if (request.method === "GET")
        return json({
          items: await rows(
            sql`SELECT e.id,e.path,e.kind,e.size FROM collection_entries i JOIN entries e ON e.id=i.entry_id WHERE i.collection_id=${id} AND e.owner_id=${owner} ORDER BY e.path LIMIT 200`,
          ),
        });
      if (request.method === "DELETE") {
        const input = await parseJson(
          request,
          z.object({ entryId: z.string().min(1).max(128) }),
        );
        await rows(
          sql`DELETE FROM collection_entries WHERE collection_id=${id} AND entry_id=${input.entryId}`,
        );
        return json({ ok: true });
      }
      if (request.method === "PUT") {
        const input = await parseJson(request, z.object({ path: pathSchema }));
        const entry = await first(
          sql`SELECT id FROM entries WHERE owner_id=${owner} AND path=${input.path}`,
        );
        if (!entry) throw errorResponse(404, "File or folder not found");
        const result = await rows(
          sql`INSERT INTO collection_entries SELECT ${id},${entry.id} WHERE (SELECT count(*) FROM collection_entries WHERE collection_id=${id})<200 ON CONFLICT(collection_id,entry_id) DO UPDATE SET entry_id=excluded.entry_id RETURNING entry_id`,
        );
        if (
          !result.length &&
          !(await first(
            sql`SELECT 1 FROM collection_entries WHERE collection_id=${id} AND entry_id=${entry.id}`,
          ))
        )
          throw errorResponse(409, "Collections hold at most 200 entries");
        return json({ ok: true });
      }
    }
  }
  return null;
}
