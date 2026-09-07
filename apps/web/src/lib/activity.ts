import { and, desc, eq, sql } from "drizzle-orm";
import { activity, createAgfsId, now } from "@agfs/db";
import { db } from "./db";
import type { RequestAuth } from "./authz";
import { authorize } from "./scope";
export async function recordActivity(
  auth: RequestAuth,
  action: string,
  path?: string,
) {
  await db.insert(activity).values({
    id: createAgfsId("evt"),
    ownerId: auth.user.id,
    action,
    path: path ?? null,
    actor:
      auth.authSource === "session"
        ? ((auth.actor ?? auth.user).name ?? (auth.actor ?? auth.user).email)
        : (auth.tokenLabel ?? "API token"),
    tokenId: auth.tokenId ?? null,
    createdAt: now(),
  });
}
export async function listActivity(auth: RequestAuth, cursor?: string) {
  authorize(auth, "read", auth.pathPrefix ?? "/");
  const prefix = auth.pathPrefix ?? "/";
  const [at, id] = cursor?.split(":") ?? [];
  return db
    .select()
    .from(activity)
    .where(
      and(
        eq(activity.ownerId, auth.user.id),
        prefix !== "/"
          ? sql`(${activity.path}=${prefix} OR substr(${activity.path},1,length(${prefix + "/"}))=${prefix + "/"})`
          : undefined,
        at && id
          ? sql`(${activity.createdAt}<${Number(at)} OR (${activity.createdAt}=${Number(at)} AND ${activity.id}<${id}))`
          : undefined,
      ),
    )
    .orderBy(desc(activity.createdAt), desc(activity.id))
    .limit(100);
}
