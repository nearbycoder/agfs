import { sql } from "drizzle-orm";
import { createAgfsId } from "@agfs/db";
import { rows } from "./platform-db";
import { atomicBatch } from "./atomic-batch";

/** Event-driven health work, capped at 100 owners; no global metric/job scan. */
export async function evaluateResourceHealth() {
  const at = Date.now(), since = Math.floor(at / 60000) - 10;
  const pending = await rows(sql`SELECT owner_id,revision FROM resource_health_queue WHERE due_at<=${at} ORDER BY due_at,owner_id LIMIT 100`);
  if (!pending.length) return { evaluated: 0 };
  // A lease gives other dirty owners priority even when one owner's revisions
  // keep changing during evaluation. Crashes leave a retry due in one minute.
  const claimed = await rows(sql`UPDATE resource_health_queue SET due_at=${at + 60000}
    WHERE (owner_id,revision) IN (SELECT json_extract(value,'$.owner_id'),json_extract(value,'$.revision') FROM json_each(${JSON.stringify(pending)})) RETURNING owner_id,revision`);
  if (!claimed.length) return { evaluated: 0 };
  const payload = JSON.stringify(claimed);
  const owners = await rows(sql`/* health-owner-evaluation */ SELECT o.owner_id,o.revision,
    coalesce(t.error_percent,10) AS error_percent,coalesce(t.backlog,100) AS backlog,coalesce(t.latency_ms,2000) AS latency_ms,
    (SELECT json_array(coalesce(sum(requests),0),coalesce(sum(errors),0),coalesce(sum(duration_ms),0),min(minute))
      FROM operation_metrics m WHERE m.owner_id=o.owner_id AND m.minute>=${since}) AS metrics,
    coalesce(c.pending,0) AS jobs,
    coalesce((SELECT count FROM resource_webhook_counts WHERE owner_id=o.owner_id AND status='failed'),0)>0 AS failed
    FROM (SELECT json_extract(value,'$.owner_id') AS owner_id,json_extract(value,'$.revision') AS revision FROM json_each(${payload})) o
    LEFT JOIN health_thresholds t INDEXED BY sqlite_autoindex_health_thresholds_1 ON t.owner_id=o.owner_id
    LEFT JOIN resource_index_counts c INDEXED BY sqlite_autoindex_resource_index_counts_1 ON c.owner_id=o.owner_id`);
  const schedule: Array<{ owner: string; revision: number; due: number | null }> = [];
  const decisions = owners.flatMap((owner) => {
    const [requests, errors, duration, oldestMinute] = JSON.parse(owner.metrics) as [number, number, number, number | null];
    schedule.push({ owner: owner.owner_id, revision: owner.revision, due: oldestMinute === null ? null : (oldestMinute + 11) * 60000 });
    return [
      ["errors", requests >= 10 && errors / requests * 100 >= owner.error_percent, "API error rate exceeded the configured threshold."],
      ["latency", requests >= 10 && duration / requests >= owner.latency_ms, "Average API latency exceeded the configured threshold."],
      ["indexing", owner.jobs >= owner.backlog, "Search indexing backlog exceeded the configured threshold."],
      ["webhooks", !!owner.failed, "Webhook deliveries exhausted their retries."],
    ].map(([kind, active, message]) => ({ id: createAgfsId("alert"), owner: owner.owner_id, kind, active: active ? 1 : 0, message }));
  });
  const encoded = JSON.stringify(decisions), next = JSON.stringify(schedule);
  await atomicBatch([
    sql`INSERT INTO health_alerts(id,owner_id,kind,message,created_at) SELECT json_extract(value,'$.id'),json_extract(value,'$.owner'),
      json_extract(value,'$.kind'),json_extract(value,'$.message'),${at} FROM json_each(${encoded}) WHERE json_extract(value,'$.active')=1 ON CONFLICT DO NOTHING`,
    sql`UPDATE health_alerts SET resolved_at=${at} WHERE resolved_at IS NULL AND (owner_id,kind) IN
      (SELECT json_extract(value,'$.owner'),json_extract(value,'$.kind') FROM json_each(${encoded}) WHERE json_extract(value,'$.active')=0)`,
    sql`UPDATE resource_health_queue SET due_at=(SELECT json_extract(value,'$.due') FROM json_each(${next}) WHERE json_extract(value,'$.owner')=resource_health_queue.owner_id)
      WHERE (owner_id,revision) IN (SELECT json_extract(value,'$.owner'),json_extract(value,'$.revision') FROM json_each(${next}) WHERE json_extract(value,'$.due') IS NOT NULL)`,
    sql`DELETE FROM resource_health_queue WHERE (owner_id,revision) IN
      (SELECT json_extract(value,'$.owner'),json_extract(value,'$.revision') FROM json_each(${next}) WHERE json_extract(value,'$.due') IS NULL)`,
    sql`UPDATE resource_health_queue SET due_at=max(due_at,${at + 1}) WHERE owner_id IN (SELECT json_extract(value,'$.owner') FROM json_each(${next}))
      AND (owner_id,revision) NOT IN (SELECT json_extract(value,'$.owner'),json_extract(value,'$.revision') FROM json_each(${next}))`,
    sql`INSERT INTO resource_owner_progress(owner_id,last_health_at) SELECT json_extract(value,'$.owner'),${at} FROM json_each(${next}) WHERE true
      ON CONFLICT(owner_id) DO UPDATE SET last_health_at=excluded.last_health_at`,
  ]);
  return { evaluated: owners.length };
}
