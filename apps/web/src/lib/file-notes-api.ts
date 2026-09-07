import { sql } from "drizzle-orm";
import { z } from "zod";
import { pathSchema } from "@agfs/contracts";
import type { RequestAuth } from "./authz";
import { authorize, canAccess } from "./scope";
import { actorId } from "./workspaces";
import { rows, first } from "./platform-db";
import { auditOperation } from "./request-context";
import { json, parseJson, errorResponse } from "./http";
export async function fileNotesApi(
  request: Request,
  auth: RequestAuth,
  path: string,
): Promise<Response | null> {
  if (path !== "/notes") return null;
  const input =
    request.method === "GET"
      ? {
          path: pathSchema.parse(new URL(request.url).searchParams.get("path")),
        }
      : await parseJson(
          request,
          z.object({
            path: pathSchema,
            entryId: z.string().min(1).max(128),
            body: z.string().max(4000),
            revision: z.number().int().min(0),
          }),
        );
  authorize(auth, request.method === "GET" ? "read" : "write", input.path);
  const entry = await first(
    sql`SELECT id,path FROM entries WHERE owner_id=${auth.user.id} AND path=${input.path}`,
  );
  if (!entry) throw errorResponse(404, "File or folder not found");
  if (request.method === "GET")
    return json({
      entry,
      canEdit: canAccess(auth, "write", input.path),
      note:
        (await first(
          sql`SELECT body,revision,updated_at AS updatedAt,actor_id AS author FROM entry_notes WHERE entry_id=${entry.id} AND owner_id=${auth.user.id}`,
        )) ?? null,
    });
  if (request.method === "PUT" && "body" in input) {
    if (input.entryId !== entry.id)
      throw errorResponse(
        409,
        "This path now points to another file. Reload its notes.",
      );
    const changed =
      await rows(sql`INSERT INTO entry_notes SELECT ${entry.id},${auth.user.id},${input.body},${actorId(auth)},1,${Date.now()}
   WHERE ${input.revision}=0 OR EXISTS(SELECT 1 FROM entry_notes WHERE entry_id=${entry.id} AND owner_id=${auth.user.id} AND revision=${input.revision})
   ON CONFLICT(entry_id) DO UPDATE SET body=excluded.body,actor_id=excluded.actor_id,revision=entry_notes.revision+1,updated_at=excluded.updated_at WHERE entry_notes.revision=${input.revision} AND entry_notes.owner_id=${auth.user.id}
   RETURNING body,revision,updated_at AS updatedAt,actor_id AS author`);
    if (!changed.length)
      throw errorResponse(
        409,
        "Notes changed since you opened them. Copy your edits, then reload before saving.",
      );
    auditOperation("file.note", input.path);
    return json({ note: changed[0] });
  }
  return null;
}
