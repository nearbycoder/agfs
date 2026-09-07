import {sql} from 'drizzle-orm';
import {storageUsageSql} from './storage-usage';
/** Recheck mutable workspace policy in the same transaction as publishing files. */
export function workspaceWriteSql(ownerId:string,actorId:string,incoming:number){
 return sql`(substr(${ownerId},1,3)!='ws_' OR EXISTS(SELECT 1 FROM workspaces w JOIN workspace_members m ON m.workspace_id=w.id
  WHERE w.id=${ownerId} AND m.user_id=${actorId} AND m.role IN ('owner','editor') AND w.paused=0
  AND ${storageUsageSql(ownerId)}+${incoming}<=w.storage_limit))`;
}
