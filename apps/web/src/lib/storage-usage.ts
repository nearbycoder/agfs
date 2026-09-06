import { sql } from "drizzle-orm";
// Count physical objects once, even when a restored version has multiple references.
export function storageUsageSql(ownerId: string) {
  return sql`(SELECT coalesce(sum(bytes),0) FROM (
    SELECT r2_key, max(size) AS bytes FROM (
      SELECT r2_key,size FROM entries WHERE owner_id=${ownerId} AND kind='file'
      UNION ALL SELECT r2_key,size FROM recovery WHERE owner_id=${ownerId} AND kind='file'
    ) GROUP BY r2_key
  ))`;
}
