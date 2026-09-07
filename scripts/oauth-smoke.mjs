import {
  Client,
  StreamableHTTPClientTransport,
} from "../apps/web/node_modules/@modelcontextprotocol/client/dist/index.mjs";
import assert from "node:assert/strict";
import { randomBytes, createHash } from "node:crypto";
import { cookie, database } from "./platform-fixtures.mjs";
const base = "http://localhost:8787",
  session = cookie();
let checks = 0;
async function call(url, init = {}, expected = 200) {
  const r = await fetch(url.startsWith("http") ? url : base + url, {
    ...init,
    redirect: "manual",
  });
  assert.equal(r.status, expected, `${url}: ${await r.clone().text()}`);
  checks++;
  return r;
}
const metadata = await (
  await call("/.well-known/oauth-authorization-server/api/auth")
).json();
const resource = await (
  await call("/.well-known/oauth-protected-resource/mcp")
).json();
assert.equal(resource.resource, base + "/mcp");
checks++;
const client = await (
  await call(
    metadata.registration_endpoint,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        client_name: "Local MCP smoke",
        application_type: "native",
        redirect_uris: ["http://127.0.0.1:9876/callback"],
        token_endpoint_auth_method: "none",
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        scope: "openid profile offline_access agfs:read agfs:write",
      }),
    },
    201,
  )
).json();
const verifier = randomBytes(32).toString("base64url"),
  challenge = createHash("sha256").update(verifier).digest("base64url");
const query = new URLSearchParams({
  client_id: client.client_id,
  redirect_uri: client.redirect_uris[0],
  response_type: "code",
  scope: "openid profile offline_access agfs:read agfs:write",
  state: "local-test-state",
  code_challenge: challenge,
  code_challenge_method: "S256",
  resource: base + "/mcp",
});
const authorization = await call(
  metadata.authorization_endpoint + "?" + query,
  {
    headers: {
      cookie: session,
      accept: "text/html",
      "sec-fetch-mode": "navigate",
    },
  },
);
const consentUrl = new URL((await authorization.json()).url, base);
assert.equal(consentUrl.pathname, "/oauth/consent");
checks++;
const signedQuery = consentUrl.search.slice(1);
const body = {
  accept: true,
  oauthQuery: signedQuery,
  workspace: "personal",
  path: "/oauth-test",
  permissions: ["read"],
};
// Tampered signed parameters cannot mint an authorization code.
await call(
  "/api/v1/platform/oauth/consent",
  {
    method: "POST",
    headers: {
      cookie: session,
      origin: base,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      ...body,
      oauthQuery: signedQuery.replace("local-test-state", "tampered-state"),
    }),
  },
  400,
);
const approved = await (
  await call("/api/v1/platform/oauth/consent", {
    method: "POST",
    headers: {
      cookie: session,
      origin: base,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  })
).json();
const callback = new URL(approved.url);
assert.equal(callback.searchParams.get("state"), "local-test-state");
const code = callback.searchParams.get("code");
assert(code);
checks++;
const tokenBody = new URLSearchParams({
  grant_type: "authorization_code",
  client_id: client.client_id,
  redirect_uri: client.redirect_uris[0],
  code,
  code_verifier: verifier,
  resource: base + "/mcp",
});
const token = await (
  await call(metadata.token_endpoint, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: tokenBody,
  })
).json();
assert(token.access_token && token.refresh_token);
assert(!token.scope.includes("agfs:write"));
checks++;
await call("/api/v1/fs/mkdir", {
  method: "POST",
  headers: {
    authorization: "Bearer agfs_local_test_alice",
    "content-type": "application/json",
  },
  body: '{"path":"/oauth-test"}',
});
await call("/api/v1/fs/list?path=/oauth-test", {
  headers: { authorization: "Bearer " + token.access_token },
});
await call(
  "/api/v1/fs/list?path=/",
  { headers: { authorization: "Bearer " + token.access_token } },
  403,
);
await call(
  "/api/v1/fs/mkdir",
  {
    method: "POST",
    headers: {
      authorization: "Bearer " + token.access_token,
      "content-type": "application/json",
    },
    body: '{"path":"/oauth-test/no"}',
  },
  403,
);
const refreshed = await (
  await call(metadata.token_endpoint, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: client.client_id,
      refresh_token: token.refresh_token,
      resource: base + "/mcp",
    }),
  })
).json();
await call("/api/v1/fs/list?path=/oauth-test", {
  headers: { authorization: "Bearer " + refreshed.access_token },
});
const mcp = new Client(
  { name: "oauth-smoke", version: "1" },
  { versionNegotiation: { mode: { pin: "2026-07-28" } } },
);
const transport = new StreamableHTTPClientTransport(new URL(base + "/mcp"), {
  requestInit: {
    headers: { authorization: "Bearer " + refreshed.access_token },
  },
});
await mcp.connect(transport);
assert.equal(transport.sessionId, undefined);
assert((await mcp.listTools()).tools.some((t) => t.name === "draft_create"));
const listed = await mcp.callTool({
  name: "fs_list",
  arguments: { path: "/oauth-test" },
});
assert(!listed.isError, JSON.stringify(listed));
checks += 3;
await mcp.close();
const claims = JSON.parse(
  Buffer.from(refreshed.access_token.split(".")[1], "base64url"),
);
database
  .prepare("UPDATE api_tokens SET revoked_at=? WHERE id=?")
  .run(Date.now(), claims.agfs_grant);
await call(
  "/api/v1/fs/list?path=/oauth-test",
  { headers: { authorization: "Bearer " + refreshed.access_token } },
  401,
);
await call(
  metadata.token_endpoint,
  {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: tokenBody,
  },
  400,
);
console.log("OAuth smoke passed:", checks, "checks.");
