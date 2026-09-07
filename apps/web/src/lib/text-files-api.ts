import { recordRecentFile } from "./recent-files";
import { pathSchema } from "@agfs/contracts";
import type { RequestAuth } from "./authz";
import { authorize, canAccess } from "./scope";
import { getEntryByPath } from "./fs";
import { requireResourceBindings } from "./bindings";
import { json, errorResponse } from "./http";
import { MAX_TEXT_BYTES, decodeEditableText } from "./text-format";
export async function textFilesApi(
  request: Request,
  auth: RequestAuth,
  route: string,
): Promise<Response | null> {
  if (route !== "/text" || request.method !== "GET") return null;
  const path = pathSchema.parse(new URL(request.url).searchParams.get("path"));
  authorize(auth, "read", path);
  const entry = await getEntryByPath(auth.user.id, path);
  if (!entry || entry.kind !== "file" || !entry.r2Key)
    throw errorResponse(404, "Text file not found");
  if ((entry.size ?? 0) > MAX_TEXT_BYTES)
    throw errorResponse(
      413,
      "Text tools support files up to 256 KiB. Download this file instead.",
    );
  const object = await requireResourceBindings("FILES_BUCKET").FILES_BUCKET.get(
    entry.r2Key,
  );
  if (!object) throw errorResponse(404, "File contents are unavailable");
  if (object.size > MAX_TEXT_BYTES) {
    await object.body?.cancel();
    throw errorResponse(413, "Text file exceeds 256 KiB");
  }
  let text: string;
  try {
    text = decodeEditableText(await new Response(object.body).arrayBuffer());
  } catch {
    throw errorResponse(415, "This file is not supported UTF-8 text");
  }
  await recordRecentFile(auth, entry.id);
  return json({
    path: entry.path,
    entryId: entry.id,
    etag: entry.etag,
    contentType: entry.contentType ?? "text/plain",
    text,
    canEdit: canAccess(auth, "write", path),
  });
}
