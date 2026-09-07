import assert from "node:assert/strict";
import { randomBytes, createHash } from "node:crypto";
import { cookie, database } from "./platform-fixtures.mjs";
const base = "http://localhost:8787",
  clientId = "https://client.example.com/client.json",
  redirect = "http://127.0.0.1:9876/callback",
  session = cookie(),
  verifier = randomBytes(32).toString("base64url"),
  state = randomBytes(16).toString("hex");
const discovery = await (
  await fetch(base + "/.well-known/oauth-authorization-server/api/auth")
).json();
assert.equal(discovery.client_id_metadata_document_supported, true);
assert.equal(
  database
    .prepare("SELECT count(*) AS n FROM oauth_client WHERE client_id=?")
    .get(clientId).n,
  0,
);
const query = new URLSearchParams({
  client_id: clientId,
  redirect_uri: redirect,
  response_type: "code",
  scope: "openid offline_access agfs:read",
  resource: base + "/mcp",
  state,
  code_challenge: createHash("sha256").update(verifier).digest("base64url"),
  code_challenge_method: "S256",
});
const authorization = await fetch(
  discovery.authorization_endpoint + "?" + query,
  {
    headers: {
      cookie: session,
      accept: "text/html",
      "sec-fetch-mode": "navigate",
    },
    redirect: "manual",
  },
);
assert.equal(authorization.status, 200, await authorization.clone().text());
const consent = new URL((await authorization.json()).url, base);
const response = await fetch(base + "/api/v1/platform/oauth/consent", {
  method: "POST",
  headers: {
    cookie: session,
    origin: base,
    "content-type": "application/json",
  },
  body: JSON.stringify({
    accept: true,
    oauthQuery: consent.search.slice(1),
    workspace: "personal",
    path: "/",
    permissions: ["read"],
  }),
});
assert.equal(response.status, 200, await response.clone().text());
const callback = new URL((await response.json()).url);
assert.equal(callback.searchParams.get("state"), state);
assert(callback.searchParams.get("code"));
const exchange = await fetch(discovery.token_endpoint, {
  method: "POST",
  headers: { "content-type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({
    grant_type: "authorization_code",
    client_id: clientId,
    redirect_uri: redirect,
    code: callback.searchParams.get("code"),
    code_verifier: verifier,
    resource: base + "/mcp",
  }),
});
assert.equal(exchange.status, 200, await exchange.clone().text());
const token = await exchange.json();
const who = await fetch(base + "/api/v1/whoami", {
  headers: { authorization: "Bearer " + token.access_token },
});
assert.equal(who.status, 200);
await who.body?.cancel();
console.log(
  "CIMD discovery, consent, code exchange, and authenticated API request passed.",
);
