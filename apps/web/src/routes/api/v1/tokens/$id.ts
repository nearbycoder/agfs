// @ts-nocheck
import { auditOperation } from "~/lib/request-context";
import { authorize } from "~/lib/scope";
import { createFileRoute } from "@tanstack/react-router";
import { successResponseSchema } from "@agfs/contracts";
import { requireRequestAuth, revokeApiToken } from "~/lib/authz";
import { handleRouteError, json } from "~/lib/http";

export const Route = createFileRoute("/api/v1/tokens/$id")({
  server: {
    handlers: {
      DELETE: async ({ params, request }) => {
        try {
          const auth = await requireRequestAuth(request);
          authorize(auth, "manage");
          auditOperation("token.revoke");
          await revokeApiToken(auth.user.id, params.id);
          return json(successResponseSchema.parse({ ok: true }));
        } catch (error) {
          return handleRouteError(error);
        }
      },
    },
  },
});
