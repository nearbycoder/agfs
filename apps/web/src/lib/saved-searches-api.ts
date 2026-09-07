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
const numericText = z
  .string()
  .regex(/^\d*$/)
  .refine((v) => !v || Number.isSafeInteger(Number(v)))
  .optional();
export const savedFilters = z.object({
  kind: z.enum(["", "file", "folder"]).optional(),
  minSize: numericText,
  maxSize: numericText,
  after: z.iso.date().or(z.literal("")).optional(),
  before: z.iso.date().or(z.literal("")).optional(),
  q: z.string().max(200).default(""),
  path: pathSchema.default("/"),
  type: z.string().max(255).default(""),
  tag: z.string().max(40).default(""),
});
export async function savedSearchesApi(
  request: Request,
  auth: RequestAuth,
  path: string,
): Promise<Response | null> {
  const match = /^\/saved-searches(?:\/([\w-]+))?$/.exec(path);
  if (!match) return null;
  if (auth.authSource !== "session")
    throw errorResponse(403, "Saved searches are personal browser preferences");
  authorize(auth, "read");
  const owner = auth.user.id,
    actor = actorId(auth),
    id = match[1];
  if (!id && request.method === "GET")
    return json({
      searches: (
        await rows(
          sql`SELECT id,name,filters,created_at AS createdAt FROM saved_searches WHERE owner_id=${owner} AND actor_id=${actor} ORDER BY name LIMIT 100`,
        )
      ).map((r) => ({ ...r, filters: JSON.parse(r.filters) })),
    });
  if (!id && request.method === "POST") {
    const input = await parseJson(
      request,
      z.object({ name, filters: savedFilters }),
    );
    const result =
      await rows(sql`INSERT INTO saved_searches SELECT ${createAgfsId("search")},${owner},${actor},${input.name},${JSON.stringify(input.filters)},${Date.now()}
   WHERE (SELECT count(*) FROM saved_searches WHERE owner_id=${owner} AND actor_id=${actor})<100 AND NOT EXISTS(SELECT 1 FROM saved_searches WHERE owner_id=${owner} AND actor_id=${actor} AND name=${input.name}) RETURNING id`);
    if (!result.length)
      throw errorResponse(
        409,
        "Use a unique name and keep at most 100 saved searches",
      );
    return json(result[0], { status: 201 });
  }
  if (id) {
    if (
      !(await first(
        sql`SELECT id FROM saved_searches WHERE id=${id} AND owner_id=${owner} AND actor_id=${actor}`,
      ))
    )
      throw errorResponse(404, "Saved search not found");
    if (request.method === "DELETE") {
      await rows(
        sql`DELETE FROM saved_searches WHERE id=${id} AND owner_id=${owner} AND actor_id=${actor}`,
      );
      return json({ ok: true });
    }
    if (request.method === "PATCH") {
      const input = await parseJson(request, z.object({ name }));
      const result = await rows(
        sql`UPDATE saved_searches SET name=${input.name} WHERE id=${id} AND owner_id=${owner} AND actor_id=${actor} AND NOT EXISTS(SELECT 1 FROM saved_searches WHERE owner_id=${owner} AND actor_id=${actor} AND name=${input.name} AND id!=${id}) RETURNING id`,
      );
      if (!result.length)
        throw errorResponse(409, "A saved search already uses that name");
      return json({ ok: true });
    }
  }
  return null;
}
