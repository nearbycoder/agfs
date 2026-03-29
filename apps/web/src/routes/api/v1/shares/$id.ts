// @ts-nocheck
import { createFileRoute } from "@tanstack/react-router";
import { successResponseSchema } from "@agfs/contracts";
import { revokeShare } from "~/lib/fs";
import { requireRequestAuth } from "~/lib/authz";
import { handleRouteError, json } from "~/lib/http";

export const Route = createFileRoute("/api/v1/shares/$id")({
  server: {
    handlers: {
      DELETE: async ({ params, request }) => {
        try {
          const auth = await requireRequestAuth(request);
          await revokeShare(auth.user.id, params.id);
          return json(successResponseSchema.parse({ ok: true }));
        } catch (error) {
          return handleRouteError(error);
        }
      },
    },
  },
});
