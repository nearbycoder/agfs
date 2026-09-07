import { sql } from "drizzle-orm";
import { getBindings } from "./bindings";
import { rows } from "./platform-db";
export async function dispatchBackground() {
  const queue = getBindings().BACKGROUND_QUEUE;
  if (!queue) return;
  const at = Date.now();
  // Database rows are the durable outbox. A lost queue send is retried by the cron dispatcher.
  await rows(
    sql`INSERT INTO queue_outbox(id,kind,created_at) SELECT j.entry_id,'index',${at} FROM index_jobs j JOIN index_job_status s ON s.entry_id=j.entry_id WHERE s.next_attempt<=${at} ON CONFLICT(id) DO UPDATE SET dispatched_at=CASE WHEN queue_outbox.dispatched_at<${at - 60000} THEN NULL ELSE queue_outbox.dispatched_at END`,
  );
  await rows(
    sql`INSERT INTO queue_outbox(id,kind,created_at) SELECT d.id,'webhook',${at} FROM webhook_deliveries d JOIN webhooks w ON w.id=d.webhook_id WHERE d.status IN ('pending','sending') AND d.next_attempt<=${at} AND w.enabled=1 ON CONFLICT(id) DO UPDATE SET dispatched_at=CASE WHEN queue_outbox.dispatched_at<${at - 60000} THEN NULL ELSE queue_outbox.dispatched_at END`,
  );
  const pending = await rows(
    sql`SELECT id,kind FROM queue_outbox WHERE dispatched_at IS NULL ORDER BY created_at LIMIT 50`,
  );
  for (const item of pending) {
    await queue.send(item);
    await rows(
      sql`UPDATE queue_outbox SET dispatched_at=${at} WHERE id=${item.id}`,
    );
  }
}
export async function consumeBackground(
  batch: MessageBatch<{ id: string; kind: string }>,
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
    if (batch.queue.endsWith("-dead")) {
      await rows(
        sql`INSERT INTO queue_failures VALUES(${item.id},${item.kind},${Date.now()},'Queue retries exhausted') ON CONFLICT(id) DO UPDATE SET created_at=excluded.created_at`,
      );
      await rows(sql`DELETE FROM queue_outbox WHERE id=${item.id}`);
      if (item.kind === "index")
        await rows(
          sql`UPDATE index_job_status SET last_error='Queue retries exhausted; reindex to retry',next_attempt=9007199254740991 WHERE entry_id=${item.id}`,
        );
      else
        await rows(
          sql`UPDATE webhook_deliveries SET status='failed',last_error='Queue retries exhausted' WHERE id=${item.id}`,
        );
      message.ack();
      continue;
    }
    try {
      if (item.kind === "index")
        await (await import("./search")).indexFiles(1, item.id);
      else await (await import("./webhooks")).deliverWebhooks(item.id);
      await rows(sql`DELETE FROM queue_outbox WHERE id=${item.id}`);
      message.ack();
    } catch {
      message.retry({ delaySeconds: 60 });
    }
  }
}
