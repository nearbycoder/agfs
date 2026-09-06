// @ts-nocheck
import { authorize } from "~/lib/scope";
import { auditOperation } from "~/lib/request-context";
import { createFileRoute } from "@tanstack/react-router";
import { successResponseSchema } from "@agfs/contracts";
import { revokeShare, listShares } from "~/lib/fs";
import { requireRequestAuth } from "~/lib/authz";
import { handleRouteError, json } from "~/lib/http";

export const Route = createFileRoute("/api/v1/shares/$id")({
  server: {
    handlers: {
      DELETE: async ({ params, request }) => {
        try {
          const auth = await requireRequestAuth(request);
          const share = (await listShares(auth.user.id)).find((s) => s.id === params.id);
          if (!share) return new Response(null, { status: 404 });
          authorize(auth, "share", share.path);
          auditOperation("share.revoke", share.path);
          await revokeShare(auth.user.id, params.id);
          return json(successResponseSchema.parse({ ok: true }));
        } catch (error) {
          return handleRouteError(error);
        }
      },
    },
  },
});
