import { sql } from "drizzle-orm";
import { pathSchema } from "@agfs/contracts";
import type { RequestAuth } from "./authz";
import { authorize } from "./scope";
import { rows, first } from "./platform-db";
import { json, errorResponse } from "./http";
export async function storageInsightsApi(
  request: Request,
  auth: RequestAuth,
  route: string,
): Promise<Response | null> {
  if (route !== "/storage/insights" || request.method !== "GET") return null;
  const path = pathSchema.parse(
    new URL(request.url).searchParams.get("path") ?? auth.pathPrefix ?? "/",
  );
  authorize(auth, "read", path);
  if (path !== "/") {
    const folder = await first(
      sql`SELECT kind FROM entries WHERE owner_id=${auth.user.id} AND path=${path}`,
    );
    if (!folder) throw errorResponse(404, "Folder not found");
    if (folder.kind !== "folder")
      throw errorResponse(400, "Choose a folder for storage insights");
  }
  const prefix = path === "/" ? "/" : path + "/";
  const scope = sql`owner_id=${auth.user.id} AND (path=${path} OR substr(path,1,length(${prefix}))=${prefix})`;
  const [summary, types, largest, folders] = await Promise.all([
    first(
      sql`SELECT coalesce(sum(CASE WHEN kind='file' THEN size ELSE 0 END),0) AS bytes,coalesce(sum(kind='file'),0) AS files,coalesce(sum(kind='folder'),0) AS folders FROM entries WHERE ${scope}`,
    ),
    rows(
      sql`SELECT coalesce(content_type,'application/octet-stream') AS type,count(*) AS files,coalesce(sum(size),0) AS bytes FROM entries WHERE ${scope} AND kind='file' GROUP BY coalesce(content_type,'application/octet-stream') ORDER BY bytes DESC,type LIMIT 20`,
    ),
    rows(
      sql`SELECT id,path,size,content_type AS contentType FROM entries WHERE ${scope} AND kind='file' ORDER BY size DESC,path LIMIT 20`,
    ),
    rows(
      sql`SELECT parent_path AS path,count(*) AS files,coalesce(sum(size),0) AS bytes FROM entries WHERE ${scope} AND kind='file' GROUP BY parent_path ORDER BY bytes DESC,parent_path LIMIT 20`,
    ),
  ]);
  return json({
    path,
    summary,
    types,
    largest,
    folders,
    generatedAt: Date.now(),
  });
}
