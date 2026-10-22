import { sql } from "drizzle-orm";
import type { RequestAuth } from "./authz";
import { authorize } from "./scope";
import { rows } from "./platform-db";
import { errorResponse } from "./http";
import { actorId } from "./workspaces";

export async function operationSeries(auth: RequestAuth, input: { hours: number; bucketMinutes: number; route?: string }) {
  authorize(auth, "manage");
  const until = (Math.floor(Date.now() / 60000 / input.bucketMinutes) + 1) * input.bucketMinutes,
    since = until - input.hours * 60;
  const result = await rows(sql`SELECT CAST(minute/${input.bucketMinutes} AS INTEGER)*${input.bucketMinutes} AS minute,sum(requests) AS requests,
    sum(errors) AS errors,sum(rejections) AS rejections,sum(duration_ms) AS durationMs
    FROM operation_metrics WHERE owner_id=${auth.user.id} AND minute>=${since} AND minute<${until}
      AND (${input.route ?? null} IS NULL OR route=${input.route ?? null}) GROUP BY CAST(minute/${input.bucketMinutes} AS INTEGER) ORDER BY minute LIMIT 168`);
  const byMinute = new Map(result.map((r) => [r.minute, r]));
  const results = [];
  for (let minute = since; minute < until; minute += input.bucketMinutes) {
    const r = byMinute.get(minute) ?? { requests: 0, errors: 0, rejections: 0, durationMs: 0 };
    results.push({ at: minute * 60000, requests: r.requests, errors: r.errors, rejections: r.rejections,
      averageMs: r.requests ? Math.round(r.durationMs / r.requests) : null });
  }
  return { from: since * 60000, through: until * 60000, bucketMinutes: input.bucketMinutes, retentionDays: 7, results };
}
export async function acknowledgeAlert(auth: RequestAuth, id: string, note: string | null) {
  authorize(auth, "manage");
  const result = await rows(sql`INSERT INTO resource_alert_state(alert_id,acknowledged_at,acknowledged_by,note)
    SELECT id,${note === null ? null : Date.now()},${note === null ? null : actorId(auth)},${note ?? ""} FROM health_alerts WHERE id=${id} AND owner_id=${auth.user.id}
    ON CONFLICT(alert_id) DO UPDATE SET acknowledged_at=excluded.acknowledged_at,acknowledged_by=excluded.acknowledged_by,note=excluded.note RETURNING alert_id`);
  if (!result.length) throw errorResponse(404, "Alert not found");
  return { ok: true, acknowledged: note !== null };
}
export async function snoozeAlert(auth: RequestAuth, id: string, minutes: number) {
  authorize(auth, "manage");
  const until = minutes ? Date.now() + minutes * 60000 : null;
  const result = await rows(sql`INSERT INTO resource_alert_state(alert_id,snoozed_until)
    SELECT id,${until} FROM health_alerts WHERE id=${id} AND owner_id=${auth.user.id}
    ON CONFLICT(alert_id) DO UPDATE SET snoozed_until=excluded.snoozed_until RETURNING alert_id`);
  if (!result.length) throw errorResponse(404, "Alert not found");
  return { ok: true, snoozedUntil: until, evaluationContinues: true };
}
