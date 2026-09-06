// @ts-nocheck
import { authorize } from "~/lib/scope";
import { auditOperation } from "~/lib/request-context";
import { createFileRoute } from "@tanstack/react-router";
import { listEntriesRequestSchema } from "@agfs/contracts";
import { listEntries } from "~/lib/fs";
import { requireRequestAuth } from "~/lib/authz";
import { handleRouteError, json, parseSearch } from "~/lib/http";

export const Route = createFileRoute("/api/v1/fs/list")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const auth = await requireRequestAuth(request);
          const query = parseSearch(request, listEntriesRequestSchema);
          authorize(auth, "read", query.path);
          return json({ path: query.path, entries: await listEntries(auth.user.id, query.path) });
        } catch (error) {
          return handleRouteError(error);
        }
      },
    },
  },
});
