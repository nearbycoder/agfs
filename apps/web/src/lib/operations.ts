import { sql } from "drizzle-orm";
import { getBindings } from "./bindings";
import { rows } from "./platform-db";
import { atomicBatch } from "./atomic-batch";
import { authorize } from "./scope";
import type { RequestAuth } from "./authz";
export function operationKind(path: string) {
  return path === "/mcp"
    ? "mcp"
    : path.includes("/search") || path.includes("/platform/storage/")
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
  const [metrics, indexing, jobs, webhooks, thresholds, alerts, credentials] = await atomicBatch([
    sql`SELECT route,sum(requests) AS requests,sum(errors) AS errors,sum(rejections) AS rejections,round(sum(duration_ms)*1.0/sum(requests)) AS averageMs FROM operation_metrics WHERE owner_id=${auth.user.id} AND minute>=${Math.floor(Date.now() / 60000) - 60} GROUP BY route`,
    sql`SELECT coalesce((SELECT pending FROM resource_index_counts WHERE owner_id=${auth.user.id}),0) AS pending,coalesce((SELECT failed FROM resource_index_counts WHERE owner_id=${auth.user.id}),0) AS failed,(SELECT queued_at FROM resource_work WHERE owner_id=${auth.user.id} AND kind='index' ORDER BY queued_at,id LIMIT 1) AS oldest`,
    sql`WITH jobs AS MATERIALIZED (SELECT id FROM resource_work WHERE owner_id=${auth.user.id} AND kind='index' ORDER BY queued_at,id LIMIT 50) SELECT e.path,s.attempts,s.last_error,s.queued_at FROM jobs j JOIN index_job_status s ON s.entry_id=j.id JOIN entries e ON e.id=j.id WHERE e.owner_id=${auth.user.id}`,
    sql`SELECT status,count FROM resource_webhook_counts WHERE owner_id=${auth.user.id} AND count>0 ORDER BY status`,
    sql`SELECT * FROM health_thresholds WHERE owner_id=${auth.user.id}`,
    sql`SELECT a.*,s.acknowledged_at AS acknowledgedAt,s.acknowledged_by AS acknowledgedBy,s.note,s.snoozed_until AS snoozedUntil,CASE WHEN s.snoozed_until>${Date.now()} THEN 0 ELSE 1 END AS visible FROM health_alerts a LEFT JOIN resource_alert_state s ON s.alert_id=a.id WHERE a.owner_id=${auth.user.id} ORDER BY a.created_at DESC LIMIT 50`,
    sql`SELECT id,label,expires_at,last_used_at FROM api_tokens WHERE owner_id=${auth.user.id} AND revoked_at IS NULL AND expires_at<${Date.now() + 7 * 86400000} ORDER BY expires_at,id LIMIT 100`,
  ]);
  return {
    metrics: metrics.results,
    indexing: indexing.results[0],
    jobs: jobs.results,
    webhooks: webhooks.results,
    thresholds: thresholds.results[0] ?? { error_percent: 10, backlog: 100, latency_ms: 2000 },
    alerts: alerts.results,
    expiringCredentials: credentials.results,
  };
}
export { evaluateResourceHealth as evaluateHealth } from "./resource-controls-scheduler";
