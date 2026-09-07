// @ts-nocheck
import { reviewShare } from "~/lib/share-review";
import { z } from "zod";
import { authorize, canAccess } from "~/lib/scope";
import { auditOperation } from "~/lib/request-context";
import { createFileRoute } from "@tanstack/react-router";
import { shareCreateRequestSchema } from "@agfs/contracts";
import { createShare, listShares } from "~/lib/fs";
import { requireRequestAuth } from "~/lib/authz";
import { handleRouteError, json, parseJson } from "~/lib/http";

export const Route = createFileRoute("/api/v1/shares")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const auth = await requireRequestAuth(request);
          return json({
            shares: (await listShares(auth.user.id)).filter((share) =>
              canAccess(auth, "share", share.path),
            ),
          });
        } catch (error) {
          return handleRouteError(error);
        }
      },
      POST: async ({ request }) => {
        try {
          const auth = await requireRequestAuth(request);
          const body = await parseJson(
            request,
            shareCreateRequestSchema.extend({
              approvedEtag: z.string().max(256).optional(),
            }),
          );
          authorize(auth, "share", body.path);
          const reviewedEtag = await reviewShare(
            auth,
            body.path,
            body.approvedEtag,
          );
          auditOperation("share.create", body.path);
          return json({
            share: await createShare(
              auth.user.id,
              body.path,
              body.ttl,
              reviewedEtag,
            ),
          });
        } catch (error) {
          return handleRouteError(error);
        }
      },
    },
  },
});
