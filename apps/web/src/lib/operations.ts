import { sql } from "drizzle-orm";
import { createAgfsId } from "@agfs/db";
import { getBindings } from "./bindings";
import { first, rows } from "./platform-db";
import { authorize } from "./scope";
import type { RequestAuth } from "./authz";
export function operationKind(path: string) {
  return path === "/mcp"
    ? "mcp"
    : path.includes("/search")
      ? "search"
      : path.includes("/upload")
        ? "upload"
        : path.includes("/download")
          ? "download"
          : "api";
}
export async function limitOperation(request: Request, auth: RequestAuth) {
  const bindings = getBindings(),
    kind = operationKind(new URL(request.url).pathname),
    limiter =
      kind === "search"
        ? bindings.SEARCH_RATE_LIMITER
        : bindings.OP_RATE_LIMITER;
  if (!limiter)
    throw new Response("Operation limits temporarily unavailable", {
      status: 503,
    });
  for (const key of [
    `owner:${auth.user.id}:${kind}`,
    `actor:${auth.tokenId ?? auth.actor?.id ?? auth.user.id}:${kind}`,
  ])
    if (!(await limiter.limit({ key })).success)
      throw new Response(
        JSON.stringify({
          error: "Operation burst limit reached. Retry in one minute.",
        }),
        {
          status: 429,
          headers: { "content-type": "application/json", "retry-after": "60" },
        },
      );
}
export async function recordMetric(
  auth: RequestAuth,
  path: string,
  status: number,
  duration: number,
) {
  const minute = Math.floor(Date.now() / 60000),
    route = operationKind(path);
  await rows(
    sql`INSERT INTO operation_metrics(owner_id,minute,route,requests,errors,rejections,duration_ms) VALUES(${auth.user.id},${minute},${route},1,${status >= 500 ? 1 : 0},${[403, 409, 429].includes(status) ? 1 : 0},${Math.max(0, Math.round(duration))}) ON CONFLICT(owner_id,minute,route) DO UPDATE SET requests=requests+1,errors=errors+excluded.errors,rejections=rejections+excluded.rejections,duration_ms=duration_ms+excluded.duration_ms`,
  );
}
export async function health(auth: RequestAuth) {
  authorize(auth, "manage");
  const metrics = await rows(
    sql`SELECT route,sum(requests) AS requests,sum(errors) AS errors,sum(rejections) AS rejections,round(sum(duration_ms)*1.0/sum(requests)) AS averageMs FROM operation_metrics WHERE owner_id=${auth.user.id} AND minute>=${Math.floor(Date.now() / 60000) - 60} GROUP BY route`,
  );
  const indexing = await first(
    sql`SELECT count(*) AS pending,sum(CASE WHEN s.attempts>0 THEN 1 ELSE 0 END) AS failed,min(s.queued_at) AS oldest FROM index_jobs j JOIN index_job_status s ON s.entry_id=j.entry_id JOIN entries e ON e.id=j.entry_id WHERE e.owner_id=${auth.user.id}`,
  );
  const jobs = await rows(
    sql`SELECT e.path,s.attempts,s.last_error,s.queued_at FROM index_jobs j JOIN index_job_status s ON s.entry_id=j.entry_id JOIN entries e ON e.id=j.entry_id WHERE e.owner_id=${auth.user.id} ORDER BY s.queued_at LIMIT 50`,
  );
  const webhooks = await rows(
    sql`SELECT d.status,count(*) AS count FROM webhook_deliveries d JOIN webhooks w ON w.id=d.webhook_id WHERE w.owner_id=${auth.user.id} GROUP BY d.status`,
  );
  const thresholds = (await first(
    sql`SELECT * FROM health_thresholds WHERE owner_id=${auth.user.id}`,
  )) ?? { error_percent: 10, backlog: 100, latency_ms: 2000 };
  const alerts = await rows(
    sql`SELECT * FROM health_alerts WHERE owner_id=${auth.user.id} ORDER BY created_at DESC LIMIT 50`,
  );
  const credentials = await rows(
    sql`SELECT id,label,expires_at,last_used_at FROM api_tokens WHERE owner_id=${auth.user.id} AND revoked_at IS NULL AND expires_at<${Date.now() + 7 * 86400000}`,
  );
  return {
    metrics,
    indexing,
    jobs,
    webhooks,
    thresholds,
    alerts,
    expiringCredentials: credentials,
  };
}
export async function evaluateHealth() {
  const owners = await rows(
    sql`SELECT owner_id FROM operation_metrics WHERE minute>=${Math.floor(Date.now() / 60000) - 10} UNION SELECT e.owner_id FROM index_jobs j JOIN index_job_status s ON s.entry_id=j.entry_id JOIN entries e ON e.id=j.entry_id UNION SELECT owner_id FROM health_alerts WHERE resolved_at IS NULL`,
  );
  for (const { owner_id: owner } of owners) {
    const t = (await first(
      sql`SELECT * FROM health_thresholds WHERE owner_id=${owner}`,
    )) ?? { error_percent: 10, backlog: 100, latency_ms: 2000 };
    const m = await first(
      sql`SELECT coalesce(sum(requests),0) AS requests,coalesce(sum(errors),0) AS errors,coalesce(sum(duration_ms),0) AS duration FROM operation_metrics WHERE owner_id=${owner} AND minute>=${Math.floor(Date.now() / 60000) - 10}`,
    );
    const jobs = await first(
      sql`SELECT count(*) AS n FROM index_jobs j JOIN index_job_status s ON s.entry_id=j.entry_id JOIN entries e ON e.id=j.entry_id WHERE e.owner_id=${owner}`,
    );
    const failed = await first(
      sql`SELECT count(*) AS n FROM webhook_deliveries d JOIN webhooks w ON w.id=d.webhook_id WHERE w.owner_id=${owner} AND d.status='failed'`,
    );
    for (const [kind, active, message] of [
      [
        "errors",
        m!.requests >= 10 && (m!.errors / m!.requests) * 100 >= t.error_percent,
        "API error rate exceeded the configured threshold.",
      ],
      [
        "latency",
        m!.requests >= 10 && m!.duration / m!.requests >= t.latency_ms,
        "Average API latency exceeded the configured threshold.",
      ],
      [
        "indexing",
        jobs!.n >= t.backlog,
        "Search indexing backlog exceeded the configured threshold.",
      ],
      [
        "webhooks",
        failed!.n > 0,
        "Webhook deliveries exhausted their retries.",
      ],
    ] as const) {
      if (active)
        await rows(
          sql`INSERT INTO health_alerts(id,owner_id,kind,message,created_at) VALUES(${createAgfsId("alert")},${owner},${kind},${message},${Date.now()}) ON CONFLICT DO NOTHING`,
        );
      else
        await rows(
          sql`UPDATE health_alerts SET resolved_at=${Date.now()} WHERE owner_id=${owner} AND kind=${kind} AND resolved_at IS NULL`,
        );
    }
  }
}
