// @ts-nocheck
import { authorize } from "~/lib/scope";
import { auditOperation } from "~/lib/request-context";
import { createFileRoute } from "@tanstack/react-router";
import { listEntriesRequestSchema } from "@agfs/contracts";
import { getEntryByPath } from "~/lib/fs";
import { streamObject } from "~/lib/r2";
import { requireRequestAuth } from "~/lib/authz";
import { createContentDisposition, errorResponse, handleRouteError, parseSearch } from "~/lib/http";

export const Route = createFileRoute("/api/v1/fs/download")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const auth = await requireRequestAuth(request);
          const query = parseSearch(request, listEntriesRequestSchema);
          authorize(auth, "read", query.path);
          auditOperation("download", query.path);
          const entry = await getEntryByPath(auth.user.id, query.path);
          if (!entry || entry.kind !== "file" || !entry.r2Key) {
            return errorResponse(404, "File not found");
          }

          return streamObject(entry.r2Key, {
            headers: {
              "content-disposition": createContentDisposition("attachment", entry.name),
            },
          });
        } catch (error) {
          return handleRouteError(error);
        }
      },
    },
  },
});
