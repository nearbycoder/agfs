import { sql } from "drizzle-orm";
import { rows, first } from "./platform-db";
import { atomicBatch } from "./atomic-batch";
import { getBindings } from "./bindings";

type Work = { id: string; kind: string; owner_id: string; due_at: number; generation: number; indexing_paused?: number; webhooks_paused?: number; enabled?: number };

/** Fifty indexed due candidates per cron turn; mutations inspect only their owner. */
export async function dispatchResourceWork(ownerId?: string) {
  const queue = getBindings().BACKGROUND_QUEUE;
  if (!queue) return { examined: 0, dispatched: 0 };
  const at = Date.now();
  let candidates: Work[], cursor = "";
  if (ownerId) {
    const policy = await first(sql`SELECT indexing_paused,webhooks_paused FROM resource_policies WHERE owner_id=${ownerId}`);
    candidates = [];
    for (const kind of ["index", "webhook"]) {
      if (kind === "index" ? policy?.indexing_paused : policy?.webhooks_paused) continue;
      candidates.push(...await rows<Work>(sql`SELECT id,kind,owner_id,due_at,generation FROM resource_work
        WHERE owner_id=${ownerId} AND kind=${kind} AND due_at<=${at} ORDER BY due_at,id LIMIT 50`));
    }
    candidates.sort((a, b) => a.due_at - b.due_at || (a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    candidates = candidates.slice(0, 50);
  } else {
    const state = await first(sql`SELECT cursor FROM resource_scheduler WHERE name='background'`);
    let position: [number, string, string, number] = [-1, "", "", at];
    if (state?.cursor) { try { position = JSON.parse(state.cursor); } catch { /* recover an invalid administrative cursor */ } }
    // Freeze a cycle's time boundary. Continuous newer arrivals cannot prevent
    // wrapping back to older paused/requeued work behind the saved position.
    const read = (p: typeof position) => rows<Work>(sql`SELECT id,kind,owner_id,due_at,generation FROM resource_work
      WHERE due_at<=${Math.min(at, p[3] ?? at)} AND (due_at,kind,id)>(${p[0]},${p[1]},${p[2]}) ORDER BY due_at,kind,id LIMIT 50`);
    candidates = await read(position);
    if (!candidates.length && state?.cursor) { position = [-1, "", "", at]; candidates = await read(position); }
    const last = candidates.at(-1);
    cursor = last ? JSON.stringify([last.due_at, last.kind, last.id, position[3] ?? at]) : "";
  }
  if (!candidates.length) {
    // A truly idle cron performs only indexed reads, without heartbeat writes.
    return { examined: 0, dispatched: 0 };
  }
  const payload = JSON.stringify(candidates.map(({ id, kind, due_at, generation }) => ({ id, kind, due_at, generation })));
  const statements = [sql`UPDATE resource_work SET due_at=${at + 60000}
    WHERE (kind,id,due_at,generation) IN (SELECT json_extract(value,'$.kind'),json_extract(value,'$.id'),json_extract(value,'$.due_at'),json_extract(value,'$.generation') FROM json_each(${payload}))
      AND (${ownerId ?? null} IS NULL OR owner_id=${ownerId ?? null})
      AND NOT EXISTS(SELECT 1 FROM resource_policies p WHERE p.owner_id=resource_work.owner_id AND
        ((kind='index' AND p.indexing_paused=1) OR (kind='webhook' AND p.webhooks_paused=1)))
      AND (kind='index' OR EXISTS(SELECT 1 FROM webhook_deliveries d JOIN webhooks w ON w.id=d.webhook_id WHERE d.id=resource_work.id AND w.owner_id=resource_work.owner_id AND w.enabled=1))
    RETURNING id,kind,owner_id,generation`];
  if (!ownerId) statements.push(sql`INSERT INTO resource_scheduler(name,cursor,updated_at) VALUES('background',${cursor},${at})
    ON CONFLICT(name) DO UPDATE SET cursor=excluded.cursor,updated_at=excluded.updated_at`);
  const [claimed] = await atomicBatch(statements);
  if (!claimed.results.length) return { examined: candidates.length, dispatched: 0 };
  // Claim precedes the send. An ambiguous/failed send is recovered after the
  // 60-second lease; at-least-once duplicate deliveries remain source-guarded.
  await queue.sendBatch(claimed.results.map((r) => ({ body: { id: r.id, kind: r.kind, generation: r.generation } })));
  const owners = [...new Set(claimed.results.map((r) => String(r.owner_id)))];
  await rows(sql`INSERT INTO resource_owner_progress(owner_id,last_dispatch_at,dispatched)
    SELECT value,${at},(SELECT count(*) FROM json_each(${JSON.stringify(claimed.results)}) j WHERE json_extract(j.value,'$.owner_id')=o.value)
    FROM json_each(${JSON.stringify(owners)}) o WHERE true ON CONFLICT(owner_id) DO UPDATE SET last_dispatch_at=excluded.last_dispatch_at,dispatched=dispatched+excluded.dispatched`);
  return { examined: candidates.length, dispatched: claimed.results.length };
}
