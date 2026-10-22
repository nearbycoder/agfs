import { sql } from "drizzle-orm";
import { getParentPath } from "@agfs/db";
import type { RequestAuth } from "./authz";
import { authorize } from "./scope";
import { rows } from "./platform-db";
import { errorResponse } from "./http";

export async function validateDraftPaths(auth: RequestAuth, changes: Record<string, any>[]) {
  if (changes.length > 30) throw errorResponse(409, "Apply supports at most 30 files per draft");
  const paths = changes.map((change) => {
    authorize(auth, "write", change.path);
    if (change.operation === "delete") authorize(auth, "delete", change.path);
    return { path: change.path, parent: getParentPath(change.path) ?? "/" };
  });
  if (!paths.length) return;
  const live = await rows(sql`SELECT e.id,e.etag,parent.kind AS parent_kind
    FROM json_each(${JSON.stringify(paths)}) p
    LEFT JOIN entries e ON e.owner_id=${auth.user.id} AND e.path=json_extract(p.value,'$.path')
    LEFT JOIN entries parent ON parent.owner_id=${auth.user.id} AND parent.path=json_extract(p.value,'$.parent')
    ORDER BY CAST(p.key AS INTEGER)`);
  for (let i = 0; i < changes.length; i++) {
    const row = live[i], change = changes[i];
    if (paths[i].parent !== "/" && row.parent_kind !== "folder")
      throw errorResponse(409, "Create the destination folder before applying the draft");
    if (!!row.id !== !!change.base_exists || (row.etag ?? null) !== change.base_etag)
      throw errorResponse(409, `Conflict at ${change.path}; create a new draft`);
  }
}
