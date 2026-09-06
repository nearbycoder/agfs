import { atomicBatch } from "./atomic-batch";
import { and, eq, lt, sql } from "drizzle-orm";
import { activity, apiTokens, deviceCodes, recovery, shareLinks, uploads } from "@agfs/db";
import { db } from "./db";
import { requireResourceBindings } from "./bindings";
import { removeExpiredRecovery } from "./recovery";
import { collectGarbage, queueObject } from "./garbage";

export async function cleanupExpired() {
  const at = Date.now();
  const bucket = requireResourceBindings("FILES_BUCKET").FILES_BUCKET;
  const abandoned = await db
    .select()
    .from(uploads)
    .where(and(sql`${uploads.status} in ('pending','completing','expired')`, lt(uploads.expiresAt, new Date(at))))
    .limit(100);
  for (const row of abandoned) {
    try {
      if (row.multipartId) {
        try {
          await bucket.resumeMultipartUpload(row.objectKey, row.multipartId).abort();
        } catch (error) {
          if (!/not found|does not exist|10024|NoSuchUpload/i.test(String(error))) throw error;
        }
      }
      await atomicBatch([queueObject(row.objectKey), db.delete(uploads).where(eq(uploads.id, row.id))]);
    } catch (error) {
      console.error("Upload cleanup failed", row.id, String(error));
    }
  }
  const expired = await db
    .select()
    .from(recovery)
    .where(lt(recovery.expiresAt, new Date(at)))
    .limit(100);
  for (const row of expired) await removeExpiredRecovery(row);
  await collectGarbage();
  await atomicBatch([
    sql`UPDATE api_tokens SET revoked_at=${at} WHERE id IN (SELECT api_token_id FROM device_codes WHERE expires_at<${at} AND consumed_at IS NULL AND api_token_id IS NOT NULL)`,
    sql`DELETE FROM device_codes WHERE device_code IN (SELECT device_code FROM device_codes WHERE expires_at<${at} LIMIT 500)`,
    sql`DELETE FROM activity WHERE id IN (SELECT id FROM activity WHERE created_at<${at - 90 * 86_400_000} LIMIT 1000)`,
    sql`DELETE FROM share_links WHERE id IN (SELECT id FROM share_links WHERE expires_at<${at - 30 * 86_400_000} LIMIT 500)`,
    sql`DELETE FROM uploads WHERE id IN (SELECT id FROM uploads WHERE status='committed' AND committed_at<${at - 7 * 86_400_000} LIMIT 500)`,
  ]);
  return { uploads: abandoned.length, recovery: expired.length };
}
