// @ts-nocheck
import { createFileRoute } from "@tanstack/react-router";
import { uploadCommitRequestSchema } from "@agfs/contracts";
import { commitUpload } from "~/lib/fs";
import { requireRequestAuth } from "~/lib/authz";
import { handleRouteError, json, parseJson } from "~/lib/http";

export const Route = createFileRoute("/api/v1/fs/uploads/$id/commit")({
  server: {
    handlers: {
      POST: async ({ params, request }) => {
        try {
          const auth = await requireRequestAuth(request);
          const body = await parseJson(request, uploadCommitRequestSchema);
          return json({ entry: await commitUpload(auth.user.id, params.id, body.etag) });
        } catch (error) {
          return handleRouteError(error);
        }
      },
    },
  },
});
