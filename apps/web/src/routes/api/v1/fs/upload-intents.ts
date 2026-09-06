// @ts-nocheck
import { authorize } from "~/lib/scope";
import { auditOperation } from "~/lib/request-context";
import { createFileRoute } from "@tanstack/react-router";
import { uploadIntentRequestSchema } from "@agfs/contracts";
import { createUploadIntent } from "~/lib/fs";
import { requireRequestAuth } from "~/lib/authz";
import { handleRouteError, json, parseJson } from "~/lib/http";

export const Route = createFileRoute("/api/v1/fs/upload-intents")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const auth = await requireRequestAuth(request);
          const body = await parseJson(request, uploadIntentRequestSchema);
          authorize(auth, "write", body.path);
          auditOperation("upload.start", body.path);
          return json(await createUploadIntent(auth.user, body));
        } catch (error) {
          return handleRouteError(error);
        }
      },
    },
  },
});
