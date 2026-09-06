import { signTicket, previewTypes } from "../../../preview/src/ticket";
import { authorize } from "./scope";
import type { RequestAuth } from "./authz";
import { getEntryByPath } from "./fs";
import { errorResponse } from "./http";
import { requireStringBindings } from "./bindings";
export async function createPreview(auth: RequestAuth, path: string) {
  authorize(auth, "read", path);
  const entry = await getEntryByPath(auth.user.id, path);
  if (!entry?.r2Key) throw errorResponse(404, "File not found");
  let type = entry.contentType?.split(";")[0].toLowerCase() ?? "";
  if (type.startsWith("text/") || ["application/json", "application/xml", "application/x-ndjson"].includes(type))
    type = "text/plain";
  if (!previewTypes.has(type))
    throw errorResponse(415, "Preview supports images, PDFs, and text files. Download this file to open it.");
  const bindings = requireStringBindings("PREVIEW_URL", "PREVIEW_SIGNING_SECRET");
  const exp = Date.now() + 5 * 60_000;
  const ticket = await signTicket({ key: entry.r2Key, type, name: entry.name, exp }, bindings.PREVIEW_SIGNING_SECRET);
  return {
    url: `${bindings.PREVIEW_URL}/view?ticket=${encodeURIComponent(ticket)}`,
    expiresAt: new Date(exp).toISOString(),
  };
}
