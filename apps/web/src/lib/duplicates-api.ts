import { sql } from "drizzle-orm";
import { pathSchema } from "@agfs/contracts";
import type { RequestAuth } from "./authz";
import { authorize } from "./scope";
import { rows } from "./platform-db";
import { decodeCursor, encodeCursor } from "./cursor";
import { json } from "./http";
export async function duplicatesApi(
  request: Request,
  auth: RequestAuth,
  route: string,
): Promise<Response | null> {
  if (route !== "/storage/duplicates" || request.method !== "GET") return null;
  const url = new URL(request.url),
    path = pathSchema.parse(
      url.searchParams.get("path") ?? auth.pathPrefix ?? "/",
    );
  authorize(auth, "read", path);
  const prefix = path === "/" ? "/" : path + "/",
    scope = JSON.stringify([auth.user.id, path]);
  const cursor = decodeCursor<{ etag: string; size: number; scope: string }>(
    url.searchParams.get("cursor") ?? undefined,
    (v) =>
      typeof v?.etag === "string" &&
      v.etag.length <= 256 &&
      Number.isSafeInteger(v.size) &&
      v.size > 0 &&
      v.scope === scope,
  );
  const where = sql`owner_id=${auth.user.id} AND (path=${path} OR substr(path,1,length(${prefix}))=${prefix}) AND kind='file' AND size>0 AND etag IS NOT NULL AND etag!='' AND etag!='uploaded'`;
  const groups = await rows(
    sql`SELECT etag,size,count(*) AS count FROM entries WHERE ${where} AND (etag>${cursor?.etag ?? ""} OR (etag=${cursor?.etag ?? ""} AND size>${cursor?.size ?? 0})) GROUP BY etag,size HAVING count(*)>1 ORDER BY etag,size LIMIT 21`,
  );
  const result = await Promise.all(
    groups
      .slice(0, 20)
      .map(async (group) => ({
        ...group,
        extraBytes: (group.count - 1) * group.size,
        files: await rows(
          sql`SELECT id,path FROM entries WHERE ${where} AND etag=${group.etag} AND size=${group.size} ORDER BY path LIMIT 50`,
        ),
      })),
  );
  const last = groups[19];
  return json({
    path,
    groups: result,
    nextCursor:
      groups.length > 20
        ? encodeCursor({ etag: last.etag, size: last.size, scope })
        : null,
  });
}
