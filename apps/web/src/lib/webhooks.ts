import { sql } from "drizzle-orm";
import { createAgfsId, normalizeAgfsPath } from "@agfs/db";
import { first, rows } from "./platform-db";
import type { RequestAuth } from "./authz";
import { authorize } from "./scope";
import { errorResponse } from "./http";
export function webhookUrl(input: string) {
  const url = new URL(input);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.hash ||
    (url.port && url.port !== "443") ||
    !/^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/i.test(url.hostname) ||
    /^\d+(\.\d+)*$/.test(url.hostname) ||
    /(?:^|\.)(localhost|local|internal|invalid|test|example)$/i.test(
      url.hostname,
    )
  )
    throw errorResponse(400, "Use a public HTTPS webhook URL on port 443");
  return url.toString();
}
export async function webhookSignature(
  secret: string,
  timestamp: string,
  payload: string,
) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const digest = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(timestamp + "." + payload),
  );
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
export async function createWebhook(
  auth: RequestAuth,
  input: { url: string; path: string; events: string[] },
) {
  authorize(auth, "manage");
  const path = normalizeAgfsPath(input.path),
    url = webhookUrl(input.url);
  const secret = createAgfsId("whsec"),
    id = createAgfsId("wh");
  const inserted =
    await rows(sql`INSERT INTO webhooks(id,owner_id,url,path_prefix,events,secret,created_at)
    SELECT ${id},${auth.user.id},${url},${path},${JSON.stringify(input.events)},${secret},${Date.now()}
    WHERE (SELECT count(*) FROM webhooks WHERE owner_id=${auth.user.id})<10 RETURNING id`);
  if (!inserted.length)
    throw errorResponse(409, "Workspace webhook limit reached");
  return { id, secret, url };
}
export async function listWebhooks(auth: RequestAuth) {
  authorize(auth, "manage");
  return rows(
    sql`SELECT id,url,path_prefix,events,enabled,created_at FROM webhooks WHERE owner_id=${auth.user.id} ORDER BY created_at DESC`,
  );
}
export async function webhookDeliveries(auth: RequestAuth, id: string) {
  authorize(auth, "manage");
  return rows(sql`SELECT d.id,d.event_id,d.attempts,d.status,d.last_status,d.last_error,d.created_at,d.next_attempt
    FROM webhook_deliveries d JOIN webhooks w ON w.id=d.webhook_id WHERE w.id=${id} AND w.owner_id=${auth.user.id} ORDER BY d.created_at DESC LIMIT 100`);
}
export async function setWebhook(
  auth: RequestAuth,
  id: string,
  enabled: boolean,
) {
  authorize(auth, "manage");
  await rows(
    sql`UPDATE webhooks SET enabled=${enabled ? 1 : 0} WHERE id=${id} AND owner_id=${auth.user.id}`,
  );
  return { ok: true };
}
export async function deliverWebhooks() {
  const at = Date.now();
  const pending =
    await rows(sql`SELECT d.id FROM webhook_deliveries d JOIN webhooks w ON w.id=d.webhook_id
    WHERE d.status IN ('pending','sending') AND d.next_attempt<=${at} AND w.enabled=1 ORDER BY d.next_attempt LIMIT 20`);
  for (const item of pending) {
    const claimed =
      await first(sql`UPDATE webhook_deliveries SET status='sending',attempts=attempts+1,next_attempt=${Date.now() + 60000}
      WHERE id=${item.id} AND status IN ('pending','sending') AND next_attempt<=${at} RETURNING *`);
    if (!claimed) continue;
    const hook = await first(
      sql`SELECT * FROM webhooks WHERE id=${claimed.webhook_id} AND enabled=1`,
    );
    if (!hook) continue;
    let status: number | null = null,
      error: string | null = null;
    try {
      const timestamp = String(Math.floor(Date.now() / 1000)),
        signature = await webhookSignature(
          hook.secret,
          timestamp,
          claimed.payload,
        );
      const response = await fetch(webhookUrl(hook.url), {
        method: "POST",
        redirect: "manual",
        signal: AbortSignal.timeout(10000),
        headers: {
          "content-type": "application/json",
          "x-agfs-event-id": claimed.event_id,
          "x-agfs-timestamp": timestamp,
          "x-agfs-signature": "v1=" + signature,
        },
        body: claimed.payload,
      });
      status = response.status;
      await response.body?.cancel();
      if (!response.ok) error = "Endpoint returned HTTP " + status;
    } catch {
      error = "Delivery failed or timed out";
    }
    await rows(sql`UPDATE webhook_deliveries SET status=${!error ? "delivered" : claimed.attempts >= 8 ? "failed" : "pending"},last_status=${status},last_error=${error},
      next_attempt=${Date.now() + Math.min(86400000, 60000 * 2 ** claimed.attempts)} WHERE id=${item.id} AND status='sending' AND attempts=${claimed.attempts}`);
  }
  return pending.length;
}
export async function retryWebhook(auth: RequestAuth, id: string) {
  authorize(auth, "manage");
  const item =
    await first(sql`UPDATE webhook_deliveries SET status='pending',attempts=0,next_attempt=${Date.now()}
    WHERE id=${id} AND status='failed' AND webhook_id IN (SELECT id FROM webhooks WHERE owner_id=${auth.user.id} AND enabled=1) RETURNING id`);
  if (!item)
    throw errorResponse(
      409,
      "Delivery missing, still pending, or webhook disabled",
    );
  return { ok: true };
}
