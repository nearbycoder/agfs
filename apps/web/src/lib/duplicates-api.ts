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
  const where = sql`entries.owner_id=${auth.user.id} AND (entries.path=${path} OR substr(entries.path,1,length(${prefix}))=${prefix}) AND entries.kind='file' AND entries.size>0 AND entries.etag IS NOT NULL AND entries.etag!='' AND entries.etag!='uploaded'`;
  const groups = await rows(
    sql`SELECT etag,size,count(*) AS count FROM entries WHERE ${where} AND (etag>${cursor?.etag ?? ""} OR (etag=${cursor?.etag ?? ""} AND size>${cursor?.size ?? 0})) GROUP BY etag,size HAVING count(*)>1 ORDER BY etag,size LIMIT 21`,
  );
  const selectedGroups = groups.slice(0, 20);
  const result = selectedGroups.map((group) => ({
    ...group,
    extraBytes: (group.count - 1) * group.size,
    files: [] as Array<{ id: string; path: string }>,
  }));
  if (selectedGroups.length) {
    // Each indexed seek stops at 50 matching files before JSON aggregation.
    // A window over all matches would rank every copy of a very common file.
    const files = await rows<{ files: string; group_index: number }>(
      sql`SELECT selected.key AS group_index, (
        SELECT json_group_array(json_object('id',id,'path',path)) FROM (
          SELECT entries.id,entries.path FROM entries WHERE ${where}
            AND entries.etag=json_extract(selected.value,'$[0]')
            AND entries.size=json_extract(selected.value,'$[1]')
          ORDER BY entries.path LIMIT 50
        )
      ) AS files FROM json_each(${JSON.stringify(selectedGroups.map((group) => [group.etag, group.size]))}) selected
      ORDER BY selected.key`,
    );
    for (const group of files) result[group.group_index].files = JSON.parse(group.files);
  }
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
