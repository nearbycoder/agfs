import { sql } from "drizzle-orm";
import { requireMcpAuth } from "@better-auth/mcp";
import { auth } from "./auth";
import { first, rows } from "./platform-db";
import { requestContext } from "./request-context";
import { errorResponse } from "./http";
import { requireStringBindings } from "./bindings";
import {
  createApiTokenForUser,
  revokeApiToken,
  type RequestAuth,
} from "./authz";
import { actorId, selectNamespace } from "./workspaces";
import { authorize, type Permission } from "./scope";

export const oauthScopes = [
  "openid",
  "profile",
  "offline_access",
  "agfs:read",
  "agfs:write",
  "agfs:delete",
  "agfs:share",
];
export async function oauthGrant(id: string, subject: string) {
  const grant =
    await first(sql`SELECT t.*,u.name,u.email,u.image FROM api_tokens t JOIN user u ON u.id=t.issued_by
    WHERE t.id=${id} AND t.issued_by=${subject} AND t.revoked_at IS NULL AND t.paused=0 AND t.expires_at>${Date.now()}`);
  if (!grant)
    throw errorResponse(401, "Connection revoked, paused, or expired");
  return grant;
}
export async function resolveOAuth(
  request: Request,
  bearer: string,
): Promise<RequestAuth> {
  const context = requestContext.getStore();
  let claims =
    context?.verifiedOAuth?.bearer === bearer
      ? context.verifiedOAuth.claims
      : undefined;
  if (!claims) {
    const response = await requireMcpAuth(
      auth,
      async (_request, verified) => {
        claims = verified;
        return new Response(null, { status: 204 });
      },
      { resource: requireStringBindings("APP_URL").APP_URL + "/mcp" },
    )(request);
    if (!claims) throw response;
    if (context) context.verifiedOAuth = { bearer, claims };
  }
  if (typeof claims.agfs_grant !== "string" || typeof claims.sub !== "string")
    throw errorResponse(401, "Invalid AGFS connection");
  const grant = await oauthGrant(claims.agfs_grant, claims.sub);
  await rows(
    sql`UPDATE api_tokens SET last_used_at=${Date.now()} WHERE id=${grant.id} AND (last_used_at IS NULL OR last_used_at<${Date.now() - 60000})`,
  );
  const actor = {
    id: grant.issued_by,
    name: grant.name,
    email: grant.email,
    image: grant.image,
  };
  const scopes =
    typeof claims.scope === "string" ? claims.scope.split(" ") : [];
  return {
    authSource: "api-token",
    tokenId: grant.id,
    tokenLabel: grant.label,
    pathPrefix: grant.path_prefix,
    permissions: (JSON.parse(grant.permissions) as Permission[]).filter((p) =>
      scopes.includes("agfs:" + p),
    ),
    actor,
    user: { ...actor, id: grant.owner_id },
    workspaceId: grant.owner_id.startsWith("ws_") ? grant.owner_id : undefined,
  };
}
export async function consentOAuth(
  request: Request,
  session: RequestAuth,
  input: {
    accept: boolean;
    oauthQuery: string;
    workspace: string;
    path: string;
    permissions: Permission[];
  },
) {
  if (session.authSource !== "session")
    throw errorResponse(403, "Sign in to approve a connection");
  const sendConsent = (body: unknown) => {
    const headers = new Headers(request.headers);
    headers.set("content-type", "application/json");
    headers.set("accept", "application/json");
    return auth.handler(
      new Request(
        requireStringBindings("APP_URL").APP_URL + "/api/auth/oauth2/consent",
        { method: "POST", headers, body: JSON.stringify(body) },
      ),
    );
  };
  if (!input.accept)
    return sendConsent({ accept: false, oauth_query: input.oauthQuery });
  const headers = new Headers(request.headers);
  headers.set("x-agfs-workspace", input.workspace);
  const namespace = await selectNamespace(
    new Request(request.url, { headers }),
    session,
  );
  const query = new URLSearchParams(input.oauthQuery),
    requested = (query.get("scope") ?? "").split(" ");
  const permissions = [...new Set(input.permissions)];
  if (
    !permissions.length ||
    permissions.some((p) => p === "manage" || !requested.includes("agfs:" + p))
  )
    throw errorResponse(400, "Choose permissions requested by this client");
  for (const permission of permissions)
    authorize(namespace, permission, input.path);
  const clientId = query.get("client_id");
  // Use the provider resolver so both registered and CIMD-discovered clients
  // receive the same validation and disabled-client checks.
  let client;
  try {
    client = await auth.api.getOAuthClientPublic({
      headers: request.headers,
      query: { client_id: clientId ?? "" },
    });
  } catch {
    throw errorResponse(400, "Unknown or unavailable OAuth client");
  }
  const created = await createApiTokenForUser(namespace.user.id, {
    label: ("MCP: " + (client.client_name ?? "Agent")).slice(0, 100),
    pathPrefix: input.path,
    permissions,
    issuedBy: actorId(session),
    ttl: "30d",
  });
  const context = requestContext.getStore();
  if (!context) throw errorResponse(500, "Missing authorization context");
  context.oauthGrantId = created.record.id;
  try {
    const response = await sendConsent({
      accept: true,
      oauth_query: input.oauthQuery,
      scope: [
        ...requested.filter((s) =>
          ["openid", "profile", "offline_access"].includes(s),
        ),
        ...permissions.map((p) => "agfs:" + p),
      ].join(" "),
    });
    if (!response.ok)
      await revokeApiToken(namespace.user.id, created.record.id);
    return response;
  } catch (error) {
    await revokeApiToken(namespace.user.id, created.record.id);
    throw error;
  } finally {
    context.oauthGrantId = undefined;
  }
}
