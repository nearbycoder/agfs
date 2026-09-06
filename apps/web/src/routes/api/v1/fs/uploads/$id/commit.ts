// @ts-nocheck
import { authorizeUpload } from "~/lib/uploads";
import { auditOperation } from "~/lib/request-context";
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
          const upload = await authorizeUpload(auth, params.id);
          auditOperation("upload.commit", upload.path);
          return json({ entry: await commitUpload(auth.user, params.id, body.etag) });
        } catch (error) {
          return handleRouteError(error);
        }
      },
    },
  },
});
