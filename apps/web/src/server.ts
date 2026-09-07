import { waitUntil } from "cloudflare:workers";
import { z } from "zod";
import { parseJson } from "./lib/http";
import { requestContext } from "./lib/request-context";
import { handleRouteError } from "./lib/http";
import {
  createStartHandler,
  defaultStreamHandler,
} from "@tanstack/react-start/server";
import { createServerEntry } from "@tanstack/react-start/server-entry";
import { getBindings } from "./lib/bindings";
import { errorResponse, requireSameOriginMutation } from "./lib/http";

const handler = createStartHandler(defaultStreamHandler);

const app = createServerEntry({
  async fetch(request, ...args) {
    const pathname = new URL(request.url).pathname;
    const securityPath = decodeURIComponent(pathname).toLowerCase();
    const bindings = getBindings();
    let response: Response;
    try {
      if (securityPath.startsWith("/api/v1/") || securityPath === "/mcp") {
        requireSameOriginMutation(request, bindings.APP_URL!);
        // Consume bounded JSON before an early auth rejection; this also keeps HTTP request reuse safe.
        if (
          !["GET", "HEAD", "OPTIONS"].includes(request.method) &&
          request.headers.get("content-type")?.split(";")[0] ===
            "application/json"
        ) {
          const body = await parseJson(request, z.unknown());
          request = new Request(request, { body: JSON.stringify(body) });
        }
      }
      if (
        securityPath.startsWith("/api/v1/device/") ||
        securityPath.startsWith("/api/auth/")
      ) {
        const limiter = bindings.AUTH_RATE_LIMITER;
        if (!limiter)
          throw errorResponse(503, "Authentication temporarily unavailable");
        const { success } = await limiter.limit({
          key: `agfs:auth:${request.headers.get("cf-connecting-ip") ?? "local"}`,
        });
        if (!success) {
          throw new Response("Too many requests", {
            status: 429,
            headers: { "retry-after": "60" },
          });
        }
      }
      if (securityPath === "/api/auth/oauth2/consent")
        throw errorResponse(
          400,
          "Approve connections through the AGFS consent page",
        );
      response = await (
        await import("./lib/idempotency")
      ).idempotent(request, async () =>
        pathname.startsWith("/.well-known/")
          ? await (await import("./lib/auth")).auth.handler(request)
          : ((await (
              await import("./lib/platform-api")
            ).platformApi(request)) ??
            (securityPath === "/mcp"
              ? await (
                  await import("./lib/mcp")
                ).serveMcp(request, (nested) => fetchRequest(nested, ...args))
              : ((await (
                  await import("./lib/extended-api")
                ).extendedApi(request)) ?? (await handler(request, ...args))))),
      );
    } catch (error) {
      response = handleRouteError(error);
    }
    const headers = new Headers(response.headers);
    headers.set("x-content-type-options", "nosniff");
    headers.set("x-frame-options", "DENY");
    headers.set("referrer-policy", "no-referrer");
    headers.set(
      "permissions-policy",
      "camera=(), microphone=(), geolocation=()",
    );
    if (new URL(request.url).protocol === "https:") {
      headers.set("strict-transport-security", "max-age=31536000");
    }
    if (
      securityPath === "/mcp" ||
      securityPath.startsWith("/api/") ||
      securityPath.startsWith("/s/") ||
      securityPath.startsWith("/app")
    ) {
      headers.set("cache-control", "private, no-store");
    }
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  },
});

async function fetchRequest(
  request: Request,
  ...args: Parameters<typeof app.fetch> extends [Request, ...infer Rest]
    ? Rest
    : never
) {
  return requestContext.run(
    { verifiedOAuth: requestContext.getStore()?.verifiedOAuth },
    async () => {
      const started = Date.now();
      const response = await app.fetch(request, ...args);
      const context = requestContext.getStore();
      if (response.ok && context?.auth && context.action) {
        try {
          await (
            await import("./lib/activity")
          ).recordActivity(context.auth, context.action, context.path);
        } catch (error) {
          console.error("Activity recording failed", error);
        }
      }
      waitUntil(
        (async () => {
          if (context?.auth) {
            try {
              await (
                await import("./lib/operations")
              ).recordMetric(
                context.auth,
                new URL(request.url).pathname,
                response.status,
                Date.now() - started,
              );
            } catch {
              console.error("Metric recording failed");
            }
          }
          if (response.ok && context?.action) {
            try {
              await (await import("./lib/background")).dispatchBackground();
            } catch {
              console.error("Background dispatch deferred to cron");
            }
          }
        })(),
      );
      return response;
    },
  );
}
export default {
  fetch: fetchRequest,
  async queue(batch: MessageBatch<{ id: string; kind: string }>) {
    await (await import("./lib/background")).consumeBackground(batch);
  },
  scheduled(
    controller: { scheduledTime: number; cron?: string },
    _env: unknown,
    context: { waitUntil(promise: Promise<unknown>): void },
  ) {
    context.waitUntil(
      (async () => {
        if (getBindings().BACKGROUND_QUEUE)
          await (await import("./lib/background")).dispatchBackground();
        else {
          await (await import("./lib/search")).indexFiles(30);
          await (await import("./lib/webhooks")).deliverWebhooks();
        }
        await (await import("./lib/operations")).evaluateHealth();
        if (
          controller.cron === "17 * * * *" ||
          new Date(controller.scheduledTime).getUTCMinutes() === 17
        )
          await (await import("./lib/cleanup")).cleanupExpired();
      })(),
    );
  },
};
