import { sql } from "drizzle-orm";
import { normalizeAgfsPath } from "@agfs/db";
import { first, rows } from "./platform-db";
import type { RequestAuth } from "./authz";
import { authorize } from "./scope";
import { errorResponse } from "./http";
export async function changes(
  auth: RequestAuth,
  input: { path?: string; since?: number; through?: number },
) {
  const path = normalizeAgfsPath(input.path ?? auth.pathPrefix ?? "/"),
    prefix = path === "/" ? "/" : path + "/";
  authorize(auth, "read", path);
  const latest = (await first(
    sql`SELECT coalesce(max(seq),0) AS n FROM change_log WHERE owner_id=${auth.user.id}`,
  ))!.n;
  const floor =
    (
      await first(
        sql`SELECT floor FROM change_watermarks WHERE owner_id=${auth.user.id}`,
      )
    )?.floor ?? 0;
  const max = Math.max(latest, floor);
  if (input.since === undefined)
    return { checkpoint: max, changes: [], nextCursor: null };
  if (input.since < floor)
    throw errorResponse(410, "Change history expired; perform a full sync");
  const through = input.through ?? max;
  if (through > max || input.since > through)
    throw errorResponse(400, "Invalid change checkpoint");
  const result = await rows(
    sql`SELECT seq,path,operation,entry FROM change_log WHERE owner_id=${auth.user.id} AND seq>${input.since} AND seq<=${through} AND (path=${path} OR substr(path,1,length(${prefix}))=${prefix}) ORDER BY seq LIMIT 501`,
  );
  const slice = result.slice(0, 500);
  return {
    checkpoint: through,
    changes: slice.map((r) => ({
      ...r,
      entry: r.entry ? JSON.parse(r.entry) : null,
    })),
    nextCursor: result.length > 500 ? slice.at(-1)!.seq : null,
  };
}
