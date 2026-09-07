import { sql } from "drizzle-orm";
import { z } from "zod";
import { createAgfsId } from "@agfs/db";
import type { RequestAuth } from "./authz";
import { authorize } from "./scope";
import { actorId } from "./workspaces";
import { rows, first } from "./platform-db";
import { json, parseJson, errorResponse } from "./http";
const fields = {
  name: z.string().trim().min(1).max(100),
  body: z.string().max(4000),
  contentType: z.enum([
    "text/plain",
    "text/markdown",
    "application/json",
    "text/csv",
  ]),
};
export async function templatesApi(
  request: Request,
  auth: RequestAuth,
  path: string,
): Promise<Response | null> {
  const match = /^\/templates(?:\/([\w-]+))?$/.exec(path);
  if (!match) return null;
  if (auth.authSource !== "session")
    throw errorResponse(403, "Templates are personal browser preferences");
  authorize(auth, "read");
  const owner = auth.user.id,
    actor = actorId(auth),
    id = match[1];
  if (!id) {
    if (request.method === "GET")
      return json({
        templates: await rows(
          sql`SELECT id,name,body,content_type AS contentType,revision,updated_at AS updatedAt FROM file_templates WHERE owner_id=${owner} AND actor_id=${actor} ORDER BY name LIMIT 50`,
        ),
      });
    if (request.method === "POST") {
      const input = await parseJson(request, z.object(fields));
      const result = await rows(
        sql`INSERT INTO file_templates SELECT ${createAgfsId("template")},${owner},${actor},${input.name},${input.body},${input.contentType},1,${Date.now()} WHERE (SELECT count(*) FROM file_templates WHERE owner_id=${owner} AND actor_id=${actor})<50 AND NOT EXISTS(SELECT 1 FROM file_templates WHERE owner_id=${owner} AND actor_id=${actor} AND name=${input.name}) RETURNING id,revision`,
      );
      if (!result.length)
        throw errorResponse(
          409,
          "Use a unique name and keep at most 50 templates",
        );
      return json(result[0], { status: 201 });
    }
  } else {
    if (
      !(await first(
        sql`SELECT id FROM file_templates WHERE id=${id} AND owner_id=${owner} AND actor_id=${actor}`,
      ))
    )
      throw errorResponse(404, "Template not found");
    if (request.method === "DELETE") {
      await rows(
        sql`DELETE FROM file_templates WHERE id=${id} AND owner_id=${owner} AND actor_id=${actor}`,
      );
      return json({ ok: true });
    }
    if (request.method === "PATCH") {
      const input = await parseJson(
        request,
        z.object({ ...fields, revision: z.number().int().positive() }),
      );
      const result = await rows(
        sql`UPDATE file_templates SET name=${input.name},body=${input.body},content_type=${input.contentType},revision=revision+1,updated_at=${Date.now()} WHERE id=${id} AND owner_id=${owner} AND actor_id=${actor} AND revision=${input.revision} AND NOT EXISTS(SELECT 1 FROM file_templates WHERE owner_id=${owner} AND actor_id=${actor} AND name=${input.name} AND id!=${id}) RETURNING id,revision`,
      );
      if (!result.length)
        throw errorResponse(
          409,
          "Template changed or the name is already used. Reload before saving.",
        );
      return json(result[0]);
    }
  }
  return null;
}
