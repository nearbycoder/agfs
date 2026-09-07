import { sql } from "drizzle-orm";
// Count physical objects once, even when a restored version has multiple references.
export function storageUsageSql(ownerId: string) {
  return sql`(SELECT coalesce(sum(bytes),0) FROM (
    SELECT r2_key, max(size) AS bytes FROM (
      SELECT r2_key,size FROM entries WHERE owner_id=${ownerId} AND kind='file'
      UNION ALL SELECT r2_key,size FROM recovery WHERE owner_id=${ownerId} AND kind='file'
    UNION ALL SELECT u.object_key,u.size FROM object_usage u WHERE u.owner_id=${ownerId} AND EXISTS(SELECT 1 FROM object_pins p WHERE p.object_key=u.object_key AND p.expires_at>unixepoch()*1000)
    ) GROUP BY r2_key
  ))`;
}
