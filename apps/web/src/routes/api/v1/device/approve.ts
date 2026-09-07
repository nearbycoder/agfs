// @ts-nocheck
import { auditOperation } from "~/lib/request-context";
import { authorize } from "~/lib/scope";
import { createFileRoute } from "@tanstack/react-router";
import {
  deviceApproveRequestSchema,
  successResponseSchema,
} from "@agfs/contracts";
import { approveDeviceAuthorization, requireRequestAuth } from "~/lib/authz";
import { handleRouteError, json, parseJson } from "~/lib/http";

export const Route = createFileRoute("/api/v1/device/approve")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const auth = await requireRequestAuth(request, true);
          authorize(auth, "manage");
          auditOperation("device.approve");
          const body = await parseJson(request, deviceApproveRequestSchema);
          await approveDeviceAuthorization(auth.user.id, body);
          return json(successResponseSchema.parse({ ok: true }));
        } catch (error) {
          return handleRouteError(error);
        }
      },
    },
  },
});
