// @ts-nocheck
import { createFileRoute } from "@tanstack/react-router";
import { handleRouteError, json } from "~/lib/http";
import { requireRequestAuth } from "~/lib/authz";

export const Route = createFileRoute("/api/v1/whoami")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const result = await requireRequestAuth(request);
          return json({
            user: result.actor ?? result.user,
            workspaceId: result.workspaceId ?? null,
            authSource: result.authSource,
          });
        } catch (error) {
          return handleRouteError(error);
        }
      },
    },
  },
});
