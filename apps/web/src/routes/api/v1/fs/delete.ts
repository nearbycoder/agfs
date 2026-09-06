// @ts-nocheck
import { authorize } from "~/lib/scope";
import { auditOperation } from "~/lib/request-context";
import { createFileRoute } from "@tanstack/react-router";
import { deleteEntryRequestSchema, successResponseSchema } from "@agfs/contracts";
import { deleteEntry } from "~/lib/fs";
import { requireRequestAuth } from "~/lib/authz";
import { handleRouteError, json, parseJson } from "~/lib/http";

export const Route = createFileRoute("/api/v1/fs/delete")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const auth = await requireRequestAuth(request);
          const body = await parseJson(request, deleteEntryRequestSchema);
          authorize(auth, "delete", body.path);
          auditOperation("trash", body.path);
          await deleteEntry(auth.user.id, body.path, body.recursive);
          return json(successResponseSchema.parse({ ok: true }));
        } catch (error) {
          return handleRouteError(error);
        }
      },
    },
  },
});
