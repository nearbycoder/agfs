// @ts-nocheck
import { createFileRoute } from "@tanstack/react-router";
import { deviceStartRequestSchema } from "@agfs/contracts";
import { handleRouteError, json, parseJson } from "~/lib/http";
import { startDeviceAuthorization } from "~/lib/authz";

export const Route = createFileRoute("/api/v1/device/start")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const body = await parseJson(request, deviceStartRequestSchema);
          return json(await startDeviceAuthorization(body.clientName));
        } catch (error) {
          return handleRouteError(error);
        }
      },
    },
  },
});
