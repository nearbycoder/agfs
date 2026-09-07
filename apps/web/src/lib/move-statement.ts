import { sql } from "drizzle-orm";
import { getBaseName, getParentPath } from "@agfs/db";

export function moveStatement(ownerId: string, source: { id: string; path: string; kind: string }, destination: string) {
  const sourcePrefix = `${source.path}/`;
  const destinationPrefix = `${destination}/`;
  const parent = getParentPath(destination);
  // Materialize the current, authorized subtree and all guards before updating it.
  // Stale IDs selected by an earlier request must not move files from another path.
  return sql`WITH moving AS MATERIALIZED (
    SELECT id FROM entries WHERE owner_id=${ownerId}
      AND (path=${source.path} OR (${source.kind}='folder' AND substr(path,1,length(${sourcePrefix}))=${sourcePrefix}))
      AND EXISTS (SELECT 1 FROM entries root WHERE root.owner_id=${ownerId} AND root.id=${source.id} AND root.path=${source.path} AND root.kind=${source.kind})
      AND NOT EXISTS (SELECT 1 FROM entries occupied WHERE occupied.owner_id=${ownerId}
        AND (occupied.path=${destination} OR substr(occupied.path,1,length(${destinationPrefix}))=${destinationPrefix}))
      AND (${parent}='/' OR EXISTS (SELECT 1 FROM entries ancestor WHERE ancestor.owner_id=${ownerId} AND ancestor.path=${parent} AND ancestor.kind='folder'))
  ) UPDATE entries SET
    path=${destination} || substr(path,length(${source.path})+1),
    parent_path=CASE WHEN id=${source.id} THEN ${parent} ELSE ${destination} || substr(parent_path,length(${source.path})+1) END,
    name=CASE WHEN id=${source.id} THEN ${getBaseName(destination)} ELSE name END,
    updated_at=${Date.now()}
  WHERE id IN (SELECT id FROM moving) RETURNING id`;
}
