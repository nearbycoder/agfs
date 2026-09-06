// @ts-nocheck
import { authorize } from "~/lib/scope";
import { createFileRoute } from "@tanstack/react-router";
import { getAccountSummaryForUser } from "~/lib/account";
import { requireRequestAuth } from "~/lib/authz";
import { handleRouteError, json } from "~/lib/http";

export const Route = createFileRoute("/api/v1/account")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const auth = await requireRequestAuth(request);
          authorize(auth, "manage");
          return json(await getAccountSummaryForUser(auth.user));
        } catch (error) {
          return handleRouteError(error);
        }
      },
    },
  },
});
