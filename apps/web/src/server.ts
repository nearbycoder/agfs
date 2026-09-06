import { createStartHandler, defaultStreamHandler } from "@tanstack/react-start/server";
import { createServerEntry } from "@tanstack/react-start/server-entry";
import { getBindings } from "./lib/bindings";
import { errorResponse, requireSameOriginMutation } from "./lib/http";

const handler = createStartHandler(defaultStreamHandler);

export default createServerEntry({
  async fetch(request, ...args) {
    const pathname = new URL(request.url).pathname;
    const securityPath = decodeURIComponent(pathname).toLowerCase();
    const bindings = getBindings();
    let response: Response;
    try {
      if (securityPath.startsWith("/api/v1/")) {
        requireSameOriginMutation(request, bindings.APP_URL!);
      }
      if (securityPath.startsWith("/api/v1/device/") || securityPath.startsWith("/api/auth/")) {
        const limiter = bindings.AUTH_RATE_LIMITER;
        if (!limiter) throw errorResponse(503, "Authentication temporarily unavailable");
        const { success } = await limiter.limit({
          key: `agfs:auth:${request.headers.get("cf-connecting-ip") ?? "local"}`,
        });
        if (!success) {
          throw new Response("Too many requests", { status: 429, headers: { "retry-after": "60" } });
        }
      }
      response = await handler(request, ...args);
    } catch (error) {
      if (!(error instanceof Response)) throw error;
      response = error;
    }
    const headers = new Headers(response.headers);
    headers.set("x-content-type-options", "nosniff");
    headers.set("x-frame-options", "DENY");
    headers.set("referrer-policy", "no-referrer");
    headers.set("permissions-policy", "camera=(), microphone=(), geolocation=()");
    if (new URL(request.url).protocol === "https:") {
      headers.set("strict-transport-security", "max-age=31536000");
    }
    if (securityPath.startsWith("/api/") || securityPath.startsWith("/s/") || securityPath.startsWith("/app")) {
      headers.set("cache-control", "private, no-store");
    }
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
  },
});
