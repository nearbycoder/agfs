import { sql } from "drizzle-orm";
import { first, rows } from "./platform-db";
import { atomicBatch } from "./atomic-batch";
import { requireWorkspaceOwner, actorId } from "./workspaces";
import { getBindings } from "./bindings";
import { errorResponse } from "./http";
import type { RequestAuth } from "./authz";
export async function invites(auth: RequestAuth) {
  await requireWorkspaceOwner(auth);
  return rows(
    sql`SELECT id,email,role,expires_at FROM workspace_invites WHERE workspace_id=${auth.workspaceId} ORDER BY expires_at DESC LIMIT 100`,
  );
}
export async function revokeInvite(auth: RequestAuth, id: string) {
  await requireWorkspaceOwner(auth);
  await rows(
    sql`DELETE FROM workspace_invites WHERE id=${id} AND workspace_id=${auth.workspaceId}`,
  );
  return { ok: true };
}
export async function emailInvite(
  auth: RequestAuth,
  email: string,
  token: string,
) {
  await requireWorkspaceOwner(auth);
  const b = getBindings();
  if (!b.RESEND_API_KEY || !b.INVITE_FROM_EMAIL)
    throw errorResponse(
      503,
      "Invitation email is not configured; use the invitation link",
    );
  const link = new URL("/app/workspaces", b.APP_URL);
  link.searchParams.set("invite", token);
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    redirect: "manual",
    signal: AbortSignal.timeout(10000),
    headers: {
      authorization: `Bearer ${b.RESEND_API_KEY}`,
      "content-type": "application/json",
      "idempotency-key": token,
    },
    body: JSON.stringify({
      from: b.INVITE_FROM_EMAIL,
      to: [email],
      subject: "Your AGFS workspace invitation",
      text: `You have been invited to an AGFS workspace. Sign in with this email address to accept:\n\n${link}\n\nThis invitation expires in seven days.`,
    }),
  });
  await response.body?.cancel();
  if (!response.ok)
    throw errorResponse(
      502,
      "Invitation email could not be delivered; use the invitation link",
    );
  return { sent: true };
}
export async function transferStatus(auth: RequestAuth) {
  if (!auth.workspaceId) throw errorResponse(400, "Choose a team workspace");
  return {
    transfer:
      (await first(
        sql`SELECT t.*,u.email AS recipient FROM ownership_transfers t JOIN user u ON u.id=t.to_id WHERE workspace_id=${auth.workspaceId} AND expires_at>${Date.now()}`,
      )) ?? null,
  };
}
export async function proposeTransfer(auth: RequestAuth, to: string) {
  await requireWorkspaceOwner(auth);
  if (auth.authSource !== "session" || to === actorId(auth))
    throw errorResponse(
      403,
      "An owner must select another member in the browser",
    );
  const result = await rows(
    sql`INSERT INTO ownership_transfers SELECT ${auth.workspaceId},${actorId(auth)},user_id,${Date.now() + 86400000} FROM workspace_members WHERE workspace_id=${auth.workspaceId} AND user_id=${to} AND role!='owner' ON CONFLICT(workspace_id) DO UPDATE SET from_id=excluded.from_id,to_id=excluded.to_id,expires_at=excluded.expires_at RETURNING workspace_id`,
  );
  if (!result.length)
    throw errorResponse(400, "Select an existing workspace member");
  return { ok: true };
}
export async function acceptTransfer(auth: RequestAuth) {
  if (auth.authSource !== "session" || !auth.workspaceId)
    throw errorResponse(403, "Accept ownership in the browser");
  const actor = actorId(auth);
  const t = await first(
    sql`SELECT * FROM ownership_transfers WHERE workspace_id=${auth.workspaceId} AND to_id=${actor} AND expires_at>${Date.now()}`,
  );
  if (!t) throw errorResponse(404, "Transfer missing or expired");
  const summary = await (
    await import("./account")
  ).getAccountSummaryForUser(auth.actor ?? auth.user);
  const guard = sql`EXISTS(SELECT 1 FROM ownership_transfers t JOIN workspaces w ON w.id=t.workspace_id WHERE t.workspace_id=${auth.workspaceId} AND t.from_id=${t.from_id} AND t.to_id=${actor} AND t.expires_at>${Date.now()} AND w.created_by=t.from_id) AND (SELECT count(*) FROM workspaces WHERE created_by=${actor})<10 AND (SELECT coalesce(sum(size),0) FROM object_usage WHERE owner_id=${auth.workspaceId})<=${summary.storageLimitBytes}`;
  const result = await atomicBatch([
    sql`UPDATE workspace_members SET role=CASE WHEN user_id=${actor} THEN 'owner' ELSE 'editor' END WHERE workspace_id=${auth.workspaceId} AND user_id IN (${actor},${t.from_id}) AND ${guard} RETURNING user_id`,
    sql`UPDATE workspaces SET created_by=${actor},storage_limit=min(storage_limit,${summary.storageLimitBytes}) WHERE id=${auth.workspaceId} AND ${guard}`,
    sql`DELETE FROM ownership_transfers WHERE workspace_id=${auth.workspaceId} AND EXISTS(SELECT 1 FROM workspaces WHERE id=${auth.workspaceId} AND created_by=${actor})`,
  ]);
  if (result[0].results.length !== 2)
    throw errorResponse(409, "Transfer changed or exceeds your account limits");
  return { ok: true };
}
