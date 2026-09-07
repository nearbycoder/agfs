import { z } from "zod";
import { pathSchema } from "@agfs/contracts";
import { requireRequestAuth } from "./authz";
import { handleRouteError, json, parseJson } from "./http";
import { listRecovery, purgeRecovery, restoreRecovery } from "./recovery";
import { listActivity } from "./activity";
import {
  abortMultipart,
  authorizeUpload,
  completeMultipart,
  multipartStatus,
  putPart,
  startMultipart,
  MAX_UPLOAD_SIZE,
} from "./uploads";
import { auditOperation } from "./request-context";
import { createPreview } from "./preview";
const multipartInput = z.object({
  ifMatch: z.string().max(256).nullable().optional(),
  path: pathSchema,
  contentType: z.string().min(1).max(255),
  size: z.number().int().positive().max(MAX_UPLOAD_SIZE),
  fingerprint: z.string().min(1).max(256),
});
const restoreInput = z.object({
  id: z.string().min(1).max(128),
  path: pathSchema.optional(),
});
export async function extendedApi(request: Request): Promise<Response | null> {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method;
  if (
    ![
      "/api/v1/recovery",
      "/api/v1/recovery/restore",
      "/api/v1/activity",
      "/api/v1/fs/preview",
    ].includes(path) &&
    !path.startsWith("/api/v1/fs/resumable")
  )
    return null;
  try {
    const auth = await requireRequestAuth(request);
    if (path === "/api/v1/activity" && method === "GET") {
      const rows = await listActivity(
        auth,
        url.searchParams.get("cursor") ?? undefined,
      );
      const last = rows.at(-1);
      return json({
        events: rows,
        nextCursor:
          rows.length === 100 && last
            ? `${last.createdAt.getTime()}:${last.id}`
            : null,
      });
    }
    if (path === "/api/v1/recovery" && method === "GET") {
      const reason = z
        .enum(["trash", "version"])
        .parse(url.searchParams.get("reason") ?? "trash");
      const cursor = z
        .string()
        .regex(/^\d+:[a-zA-Z0-9_]+$/)
        .max(256)
        .optional()
        .parse(url.searchParams.get("cursor") ?? undefined);
      const items = await listRecovery(
        auth,
        reason,
        url.searchParams.get("path") ?? undefined,
        cursor,
      );
      const last = items.at(-1);
      return json({
        items,
        nextCursor:
          items.length === 200 && last
            ? `${last.retainedAt.getTime()}:${last.id}`
            : null,
      });
    }
    if (path === "/api/v1/recovery" && method === "DELETE") {
      const removedPath = await purgeRecovery(
        auth,
        z.string().min(1).max(128).parse(url.searchParams.get("id")),
      );
      auditOperation("recovery.purge", removedPath);
      return json({ ok: true });
    }
    if (path === "/api/v1/recovery/restore" && method === "POST") {
      const input = await parseJson(request, restoreInput);
      const result = await restoreRecovery(auth, input.id, input.path);
      auditOperation("recovery.restore", result.path);
      return json(result);
    }
    if (path === "/api/v1/fs/preview" && method === "POST") {
      const input = await parseJson(request, z.object({ path: pathSchema }));
      const result = await createPreview(auth, input.path);
      auditOperation("preview", input.path);
      return json(result);
    }
    if (path === "/api/v1/fs/resumable" && method === "POST") {
      const input = await parseJson(request, multipartInput);
      const result = await startMultipart(auth, input);
      auditOperation("upload.start", input.path);
      return json(result);
    }
    const match =
      /^\/api\/v1\/fs\/resumable\/([a-zA-Z0-9_-]+)(?:\/(complete|parts\/(\d+)))?$/.exec(
        path,
      );
    if (match) {
      const id = match[1];
      if (!match[2] && method === "GET")
        return json(await multipartStatus(auth, id));
      if (!match[2] && method === "DELETE") {
        await abortMultipart(auth, id);
        return json({ ok: true });
      }
      if (match[2] === "complete" && method === "POST") {
        const upload = await authorizeUpload(auth, id);
        const result = await completeMultipart(auth, id);
        auditOperation("upload.commit", upload.path);
        return json(result);
      }
      if (match[3] && method === "PUT")
        return json(await putPart(auth, id, Number(match[3]), request));
    }
    return json({ error: "Method or route not supported" }, { status: 405 });
  } catch (error) {
    return handleRouteError(error);
  }
}
