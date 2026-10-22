import { sql } from "drizzle-orm";
import { createAgfsId } from "@agfs/db";
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
    sql`SELECT count(*) AS pending,sum(CASE WHEN s.attempts>0 THEN 1 ELSE 0 END) AS failed,min(s.queued_at) AS oldest FROM index_jobs j JOIN index_job_status s ON s.entry_id=j.entry_id JOIN entries e ON e.id=j.entry_id WHERE e.owner_id=${auth.user.id}`,
    sql`SELECT e.path,s.attempts,s.last_error,s.queued_at FROM index_jobs j JOIN index_job_status s ON s.entry_id=j.entry_id JOIN entries e ON e.id=j.entry_id WHERE e.owner_id=${auth.user.id} ORDER BY s.queued_at LIMIT 50`,
    sql`SELECT d.status,count(*) AS count FROM webhook_deliveries d JOIN webhooks w ON w.id=d.webhook_id WHERE w.owner_id=${auth.user.id} GROUP BY d.status`,
    sql`SELECT * FROM health_thresholds WHERE owner_id=${auth.user.id}`,
    sql`SELECT * FROM health_alerts WHERE owner_id=${auth.user.id} ORDER BY created_at DESC LIMIT 50`,
    sql`SELECT id,label,expires_at,last_used_at FROM api_tokens WHERE owner_id=${auth.user.id} AND revoked_at IS NULL AND expires_at<${Date.now() + 7 * 86400000}`,
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
// SQLite BINARY orders UTF-8 text by code point, unlike JS's UTF-16 string order.
function ownerBefore(left: string, right: string) {
  let i = 0, j = 0;
  while (i < left.length && j < right.length) {
    const a = left.codePointAt(i)!, b = right.codePointAt(j)!;
    if (a !== b) return a < b;
    i += a > 0xffff ? 2 : 1;
    j += b > 0xffff ? 2 : 1;
  }
  return i === left.length && j < right.length;
}

export async function evaluateHealth() {
  const since = Math.floor(Date.now() / 60000) - 10;
  // Probe empty sources once using their small/predicate indexes. In particular,
  // an empty job queue must not cause a walk of the potentially huge entries table.
  const [available] = await rows(sql`/* health-source-availability */ SELECT
    EXISTS(SELECT 1 FROM operation_metrics WHERE minute>=${since}) AS metrics,
    EXISTS(SELECT 1 FROM index_jobs j JOIN index_job_status s ON s.entry_id=j.entry_id) AS indexing,
    EXISTS(SELECT 1 FROM health_alerts WHERE resolved_at IS NULL) AS alerts,
    EXISTS(SELECT 1 FROM webhook_deliveries WHERE status='failed') AS webhooks`);
  // Each source has its own cursor and a permanent exhaustion flag for this run.
  // A sparse/empty source is not rescanned while another source supplies pages.
  // Owner-leading indexes also prevent the planner from rescanning a global
  // time/status index once per owner (especially after ANALYZE).
  const sources = [
    (after: string) => sql`/* health-source-metrics */ SELECT owner_id
      FROM operation_metrics INDEXED BY sqlite_autoindex_operation_metrics_1
      WHERE owner_id>${after} AND minute>=${since} GROUP BY owner_id ORDER BY owner_id LIMIT 100`,
    (after: string) => sql`/* health-source-indexing */ SELECT j.owner_id
      FROM index_job_owners j INDEXED BY index_job_owners_owner_entry_idx
      WHERE j.owner_id>${after} AND EXISTS(SELECT 1 FROM index_job_status s WHERE s.entry_id=j.entry_id)
      GROUP BY j.owner_id ORDER BY j.owner_id LIMIT 100`,
    (after: string) => sql`/* health-source-alerts */ SELECT owner_id
      FROM health_alerts INDEXED BY active_health_alert
      WHERE owner_id>${after} AND resolved_at IS NULL GROUP BY owner_id ORDER BY owner_id LIMIT 100`,
    (after: string) => sql`/* health-source-webhooks */ SELECT w.owner_id
      FROM webhooks w INDEXED BY webhooks_owner_enabled_idx
      WHERE w.owner_id>${after} AND EXISTS(SELECT 1 FROM webhook_deliveries d INDEXED BY sqlite_autoindex_webhook_deliveries_2
        WHERE d.webhook_id=w.id AND d.status='failed') GROUP BY w.owner_id ORDER BY w.owner_id LIMIT 100`,
  ].map((query, index) => ({
    query, after: "", owners: [] as string[], position: 0,
    exhausted: !available[["metrics", "indexing", "alerts", "webhooks"][index]],
  }));
  let lastOwner: string | undefined;
  for (;;) {
    const selected: string[] = [];
    while (selected.length < 100) {
      const empty = sources.filter((source) => !source.exhausted && source.position === source.owners.length);
      if (empty.length) {
        const pages = await atomicBatch(empty.map((source) => source.query(source.after)));
        empty.forEach((source, index) => {
          source.owners = pages[index].results.map((row) => String(row.owner_id));
          source.position = 0;
          source.exhausted = source.owners.length < 100;
          source.after = source.owners.at(-1) ?? source.after;
        });
      }
      const heads = sources.filter((source) => source.position < source.owners.length);
      if (!heads.length) break;
      const next = heads.reduce((first, source) => {
        const owner = source.owners[source.position];
        return ownerBefore(owner, first) ? owner : first;
      }, heads[0].owners[heads[0].position]);
      for (const source of heads) if (source.owners[source.position] === next) source.position++;
      if (next !== lastOwner) selected.push(next);
      lastOwner = next;
    }
    if (!selected.length) break;
    // json_each is the bounded outer loop. Each correlated aggregate seeks only
    // that owner's rows. Combine the three metric sums in one indexed scan.
    const owners = await rows(sql`/* health-owner-evaluation */ SELECT o.value AS owner_id,
      coalesce(t.error_percent,10) AS error_percent,coalesce(t.backlog,100) AS backlog,coalesce(t.latency_ms,2000) AS latency_ms,
      (SELECT json_array(coalesce(sum(requests),0),coalesce(sum(errors),0),coalesce(sum(duration_ms),0))
        FROM operation_metrics m WHERE m.owner_id=o.value AND m.minute>=${since}) AS metrics,
      (SELECT count(*) FROM index_job_owners j INDEXED BY index_job_owners_owner_entry_idx CROSS JOIN index_job_status s
        WHERE j.owner_id=o.value AND s.entry_id=j.entry_id) AS jobs,
      EXISTS(SELECT 1 FROM webhooks w INDEXED BY webhooks_owner_enabled_idx
        CROSS JOIN webhook_deliveries d INDEXED BY sqlite_autoindex_webhook_deliveries_2
        WHERE w.owner_id=o.value AND d.webhook_id=w.id AND d.status='failed') AS failed
      FROM json_each(${JSON.stringify(selected)}) o LEFT JOIN health_thresholds t ON t.owner_id=o.value`);
    const decisions = owners.flatMap((owner) => {
      const [requests, errors, duration] = JSON.parse(owner.metrics) as [number, number, number];
      return [
        ["errors", requests >= 10 && (errors / requests) * 100 >= owner.error_percent,
          "API error rate exceeded the configured threshold."],
        ["latency", requests >= 10 && duration / requests >= owner.latency_ms,
          "Average API latency exceeded the configured threshold."],
        ["indexing", owner.jobs >= owner.backlog, "Search indexing backlog exceeded the configured threshold."],
        ["webhooks", owner.failed > 0, "Webhook deliveries exhausted their retries."],
      ].map(([kind, active, message]) => ({
        id: createAgfsId("alert"), owner: owner.owner_id, kind, active: active ? 1 : 0, message,
      }));
    });
    const payload = JSON.stringify(decisions), at = Date.now();
    await atomicBatch([
      sql`INSERT INTO health_alerts(id,owner_id,kind,message,created_at)
        SELECT json_extract(value,'$.id'),json_extract(value,'$.owner'),json_extract(value,'$.kind'),json_extract(value,'$.message'),${at}
        FROM json_each(${payload}) WHERE json_extract(value,'$.active')=1 ON CONFLICT DO NOTHING`,
      sql`UPDATE health_alerts SET resolved_at=${at} WHERE resolved_at IS NULL
        AND (owner_id,kind) IN (SELECT json_extract(value,'$.owner'),json_extract(value,'$.kind')
          FROM json_each(${payload}) WHERE json_extract(value,'$.active')=0)`,
    ]);
  }
}
