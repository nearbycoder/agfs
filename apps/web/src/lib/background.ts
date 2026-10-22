import { sql } from "drizzle-orm";
import { rows } from "./platform-db";
import { atomicBatch } from "./atomic-batch";
export { dispatchResourceWork as dispatchBackground } from "./resource-controls-background";
export async function consumeBackground(
  batch: MessageBatch<{ id: string; kind: string; generation?: number }>,
) {
  for (const message of batch.messages) {
    const item = message.body;
    if (
      !item ||
      typeof item.id !== "string" ||
      !["index", "webhook"].includes(item.kind)
    ) {
      message.ack();
      continue;
    }
    // New messages bind to a logical job generation. Old pre-migration queue
    // messages remain accepted; stale new messages cannot exhaust newer work.
    if (item.generation !== undefined) {
      if (!Number.isSafeInteger(item.generation) || !(await rows(sql`SELECT 1 FROM resource_work WHERE kind=${item.kind} AND id=${item.id} AND generation=${item.generation}`)).length) {
        message.ack(); continue;
      }
    }
    if (batch.queue.endsWith("-dead")) {
      // A legacy message has no generation proof. Record its diagnostic, but
      // never retire whatever newer source work now happens to use that ID.
      if (item.generation === undefined) {
        await rows(sql`INSERT INTO queue_failures(id,kind,created_at,last_error) VALUES(${item.id},${item.kind},${Date.now()},'Legacy queue retries exhausted; current work retained')
          ON CONFLICT(id) DO UPDATE SET created_at=excluded.created_at,last_error=excluded.last_error`);
        message.ack(); continue;
      }
      const guard = sql`EXISTS(SELECT 1 FROM resource_work WHERE kind=${item.kind} AND id=${item.id} AND (${item.generation ?? null} IS NULL OR generation=${item.generation ?? null}))`;
      await atomicBatch([
        sql`INSERT INTO queue_failures(id,kind,created_at,last_error) SELECT ${item.id},${item.kind},${Date.now()},'Queue retries exhausted' WHERE ${guard}
          ON CONFLICT(id) DO UPDATE SET created_at=excluded.created_at`,
        item.kind === "index"
          ? sql`UPDATE index_job_status SET attempts=max(attempts,1),last_error='Queue retries exhausted; reindex to retry',next_attempt=9007199254740991 WHERE entry_id=${item.id} AND ${guard}`
          : sql`UPDATE webhook_deliveries SET status='failed',last_error='Queue retries exhausted' WHERE id=${item.id} AND status IN ('pending','sending') AND ${guard}`,
        sql`DELETE FROM queue_outbox WHERE id=${item.id}`,
      ]);
      message.ack();
      continue;
    }
    try {
      if (item.kind === "index")
        await (await import("./search")).indexFiles(1, item.id, item.generation);
      else await (await import("./webhooks")).deliverWebhooks(item.id, item.generation);
      await rows(sql`DELETE FROM queue_outbox WHERE id=${item.id}`);
      message.ack();
    } catch {
      message.retry({ delaySeconds: 60 });
    }
  }
}
