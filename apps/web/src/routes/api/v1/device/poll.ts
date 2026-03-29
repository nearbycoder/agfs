// @ts-nocheck
import { createFileRoute } from "@tanstack/react-router";
import { devicePollRequestSchema } from "@agfs/contracts";
import { handleRouteError, json, parseJson } from "~/lib/http";
import { pollDeviceAuthorization } from "~/lib/authz";

export const Route = createFileRoute("/api/v1/device/poll")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const body = await parseJson(request, devicePollRequestSchema);
          return json(await pollDeviceAuthorization(body.deviceCode));
        } catch (error) {
          return handleRouteError(error);
        }
      },
    },
  },
});
