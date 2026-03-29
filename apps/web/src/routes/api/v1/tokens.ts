// @ts-nocheck
import { createFileRoute } from "@tanstack/react-router";
import { successResponseSchema, tokenCreateRequestSchema } from "@agfs/contracts";
import { createApiTokenForUser, listApiTokens, requireRequestAuth } from "~/lib/authz";
import { handleRouteError, json, parseJson } from "~/lib/http";

export const Route = createFileRoute("/api/v1/tokens")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const auth = await requireRequestAuth(request);
          return json({ tokens: await listApiTokens(auth.user.id) });
        } catch (error) {
          return handleRouteError(error);
        }
      },
      POST: async ({ request }) => {
        try {
          const auth = await requireRequestAuth(request);
          const body = await parseJson(request, tokenCreateRequestSchema);
          return json(await createApiTokenForUser(auth.user.id, body));
        } catch (error) {
          return handleRouteError(error);
        }
      },
    },
  },
});
