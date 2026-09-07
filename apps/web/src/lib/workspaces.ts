import { sql } from "drizzle-orm";
import { createAgfsId, hashSecret, normalizeAgfsPath } from "@agfs/db";
import { first, rows } from "./platform-db";
import { atomicBatch } from "./atomic-batch";
import { ALL_PERMISSIONS, type Permission, authorize } from "./scope";
import { errorResponse } from "./http";
import type { RequestAuth } from "./authz";
export const rolePermissions: Record<string, Permission[]> = {
  owner: ALL_PERMISSIONS,
  editor: ["read", "write", "delete", "share"],
  viewer: ["read"],
};
export function actorId(auth: RequestAuth) {
  return auth.actor?.id ?? auth.user.id;
}
export async function selectNamespace(
  request: Request,
  auth: RequestAuth,
): Promise<RequestAuth> {
  const actor = auth.actor ?? auth.user;
  const explicit = request.headers.get("x-agfs-workspace");
  const selectedCookie = request.headers
    .get("cookie")
    ?.split(";")
    .map((v) => v.trim())
    .find((v) => v.startsWith("agfs_workspace="))
    ?.slice(15);
  const workspaceId =
    auth.authSource === "api-token"
      ? auth.workspaceId
      : (explicit ?? selectedCookie);
  if (
    auth.authSource === "api-token" &&
    explicit &&
    explicit !== (workspaceId ?? "personal")
  ) {
    throw errorResponse(403, "This token belongs to a different workspace");
  }
  if (!workspaceId || workspaceId === "personal") return { ...auth, actor };
  const member =
    await first(sql`SELECT w.*, m.role, u.email AS billing_email FROM workspaces w
    JOIN workspace_members m ON m.workspace_id=w.id JOIN user u ON u.id=w.created_by
    WHERE w.id=${workspaceId} AND m.user_id=${actor.id}`);
  if (!member) throw errorResponse(403, "Workspace membership required");
  const allowed = rolePermissions[member.role] ?? [];
  const permissions = (auth.permissions ?? ALL_PERMISSIONS).filter((p) =>
    allowed.includes(p),
  );
  return {
    ...auth,
    actor,
    workspaceId,
    workspaceRole: member.role,
    workspacePaused: !!member.paused,
    permissions,
    user: { ...actor, id: workspaceId, email: member.billing_email },
  };
}
export async function listWorkspaces(auth: RequestAuth) {
  return rows(sql`SELECT w.id,w.name,w.paused,w.storage_limit,m.role FROM workspaces w
    JOIN workspace_members m ON m.workspace_id=w.id WHERE m.user_id=${actorId(auth)} ORDER BY w.created_at`);
}
export async function createWorkspace(auth: RequestAuth, name: string) {
  if (auth.authSource !== "session")
    throw errorResponse(403, "Create workspaces in the browser");
  const creator = actorId(auth),
    id = createAgfsId("ws"),
    at = Date.now();
  const result = await atomicBatch([
    sql`INSERT INTO user(id,name,email) SELECT ${id},${name},${id + "@workspaces.invalid"} WHERE (SELECT count(*) FROM workspaces WHERE created_by=${creator})<10 RETURNING id`,
    sql`INSERT INTO workspaces(id,name,created_by,created_at) SELECT ${id},${name},${creator},${at} WHERE EXISTS(SELECT 1 FROM user WHERE id=${id})`,
    sql`INSERT INTO workspace_members SELECT ${id},${creator},'owner',${at} WHERE EXISTS(SELECT 1 FROM workspaces WHERE id=${id})`,
  ]);
  if (!result[0].results.length)
    throw errorResponse(409, "Workspace limit reached");
  return { id, name, role: "owner" };
}
export async function requireWorkspaceOwner(auth: RequestAuth) {
  authorize(auth, "manage");
  if (!auth.workspaceId || auth.workspaceRole !== "owner")
    throw errorResponse(403, "Workspace owner required");
}
export async function inviteMember(
  auth: RequestAuth,
  email: string,
  role: "editor" | "viewer",
) {
  await requireWorkspaceOwner(auth);
  const token = createAgfsId("invite"),
    id = createAgfsId("inv");
  const inserted = await rows(
    sql`INSERT INTO workspace_invites SELECT ${id},${auth.workspaceId},${email.toLowerCase()},${role},${hashSecret(token)},${actorId(auth)},${Date.now() + 7 * 86400000} WHERE (SELECT count(*) FROM workspace_invites WHERE workspace_id=${auth.workspaceId})<100 RETURNING id`,
  );
  if (!inserted.length)
    throw errorResponse(
      409,
      "Invitation limit reached; revoke old invitations first",
    );
  return { id, token };
}
export async function acceptInvite(auth: RequestAuth, token: string) {
  if (auth.authSource !== "session")
    throw errorResponse(403, "Sign in to accept the invitation");
  const actor = auth.actor ?? auth.user;
  const invite = await first(
    sql`SELECT * FROM workspace_invites WHERE token_hash=${hashSecret(token)} AND email=${actor.email.toLowerCase()} AND expires_at>${Date.now()}`,
  );
  if (!invite)
    throw errorResponse(
      404,
      "Invitation missing, expired, or issued to a different email",
    );
  const accepted = await atomicBatch([
    sql`INSERT INTO workspace_members(workspace_id,user_id,role,created_at)
      SELECT workspace_id,${actor.id},role,${Date.now()} FROM workspace_invites WHERE id=${invite.id} AND expires_at>${Date.now()}
      ON CONFLICT(workspace_id,user_id) DO NOTHING`,
    sql`DELETE FROM workspace_invites WHERE id=${invite.id}`,
  ]);
  if (!accepted[1].meta.changes)
    throw errorResponse(409, "Invitation expired or was revoked");
  return { workspaceId: invite.workspace_id };
}
export async function members(auth: RequestAuth) {
  await requireWorkspaceOwner(auth);
  return rows(
    sql`SELECT m.user_id,m.role,u.name,u.email FROM workspace_members m JOIN user u ON u.id=m.user_id WHERE workspace_id=${auth.workspaceId} ORDER BY m.created_at`,
  );
}
export async function updateMember(
  auth: RequestAuth,
  userId: string,
  role: "editor" | "viewer" | null,
) {
  await requireWorkspaceOwner(auth);
  // The original owner stays responsible for billing and cannot be removed or demoted.
  const result = role
    ? await rows(
        sql`UPDATE workspace_members SET role=${role} WHERE workspace_id=${auth.workspaceId} AND user_id=${userId} AND role!='owner' RETURNING user_id`,
      )
    : await rows(
        sql`DELETE FROM workspace_members WHERE workspace_id=${auth.workspaceId} AND user_id=${userId} AND role!='owner' RETURNING user_id`,
      );
  if (!result.length)
    throw errorResponse(409, "Member missing or is the workspace owner");
  return { ok: true };
}
export async function updateWorkspace(
  auth: RequestAuth,
  input: { name: string; paused: boolean; storageLimit: number },
) {
  await requireWorkspaceOwner(auth);
  const { getAccountSummaryForUser } = await import("./account");
  const summary = await getAccountSummaryForUser({
    ...auth.user,
    id: actorId(auth),
  });
  if (input.storageLimit > summary.storageLimitBytes)
    throw errorResponse(400, "Workspace budget cannot exceed the account plan");
  await rows(
    sql`UPDATE workspaces SET name=${input.name},paused=${input.paused ? 1 : 0},storage_limit=${input.storageLimit} WHERE id=${auth.workspaceId}`,
  );
  return { ok: true };
}
