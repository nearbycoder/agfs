// @ts-nocheck
import { createFileRoute } from "@tanstack/react-router";
import { moveEntryRequestSchema, successResponseSchema } from "@agfs/contracts";
import { moveEntry } from "~/lib/fs";
import { requireRequestAuth } from "~/lib/authz";
import { handleRouteError, json, parseJson } from "~/lib/http";

export const Route = createFileRoute("/api/v1/fs/move")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const auth = await requireRequestAuth(request);
          const body = await parseJson(request, moveEntryRequestSchema);
          await moveEntry(auth.user.id, body.from, body.to);
          return json(successResponseSchema.parse({ ok: true }));
        } catch (error) {
          return handleRouteError(error);
        }
      },
    },
  },
});
