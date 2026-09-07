import { z } from "zod";
import { sql } from "drizzle-orm";
import { pathSchema } from "@agfs/contracts";
import { getParentPath, getBaseName } from "@agfs/db";
import type { RequestAuth } from "./authz";
import { authorize } from "./scope";
import { json, parseJson, errorResponse } from "./http";
import { rows } from "./platform-db";
import { auditOperation } from "./request-context";
const inputSchema = z.object({
  dryRun: z.boolean(),
  changes: z
    .array(
      z.object({
        from: pathSchema,
        to: pathSchema,
        entryId: z.string().min(1).max(128),
        etag: z.string().max(256).nullable(),
      }),
    )
    .min(1)
    .max(50),
});
export async function batchRenameApi(
  request: Request,
  auth: RequestAuth,
  route: string,
): Promise<Response | null> {
  if (route !== "/batch-rename" || request.method !== "POST") return null;
  const input = await parseJson(request, inputSchema);
  const parent = getParentPath(input.changes[0].from);
  if (parent === null) throw errorResponse(400, "Cannot rename the root");
  const ids = new Set(),
    targets = new Set();
  for (const c of input.changes) {
    authorize(auth, "write", c.from, c.to);
    if (
      c.from === c.to ||
      getParentPath(c.from) !== parent ||
      getParentPath(c.to) !== parent ||
      ids.has(c.entryId) ||
      targets.has(c.to) ||
      getBaseName(c.to).length > 255
    )
      throw errorResponse(
        400,
        "Choose distinct files and unused names within one folder",
      );
    ids.add(c.entryId);
    targets.add(c.to);
  }
  const desired = JSON.stringify(
    input.changes.map((c) => ({ ...c, name: getBaseName(c.to) })),
  );
  const guard = sql`WITH desired AS MATERIALIZED (SELECT json_extract(value,'$.entryId') AS id, json_extract(value,'$.from') AS source, json_extract(value,'$.to') AS target, json_extract(value,'$.etag') AS etag, json_extract(value,'$.name') AS name FROM json_each(${desired})), allowed AS MATERIALIZED (SELECT 1 AS ok WHERE (SELECT count(*) FROM entries e JOIN desired d ON e.id=d.id AND e.path=d.source AND e.etag IS d.etag WHERE e.owner_id=${auth.user.id} AND e.kind='file')=${input.changes.length} AND NOT EXISTS (SELECT 1 FROM entries e JOIN desired d ON e.path=d.target WHERE e.owner_id=${auth.user.id}))`;
  if (input.dryRun) {
    const ready = await rows(sql`${guard} SELECT ok FROM allowed`);
    if (!ready.length)
      throw errorResponse(
        409,
        "A file changed or a destination already exists. Refresh the folder and preview again.",
      );
    return json({ changes: input.changes });
  }
  const renamed = await rows(
    sql`${guard} UPDATE entries SET path=(SELECT target FROM desired WHERE desired.id=entries.id), name=(SELECT name FROM desired WHERE desired.id=entries.id), updated_at=${Date.now()} WHERE owner_id=${auth.user.id} AND id IN (SELECT id FROM desired) AND EXISTS (SELECT 1 FROM allowed) RETURNING id,path`,
  );
  if (renamed.length !== input.changes.length)
    throw errorResponse(
      409,
      "A file changed or a destination already exists. No files were renamed.",
    );
  auditOperation("file.batch-rename", parent);
  return json({ renamed });
}
