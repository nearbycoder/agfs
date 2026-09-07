import assert from "node:assert/strict";
import { OAuthSession } from "../packages/sdk/dist/oauth.js";
import { AgfsClient } from "../packages/sdk/dist/index.js";
import { cookie } from "./platform-fixtures.mjs";
const base = "http://localhost:8787",
  session = cookie();
async function approve(url) {
  const r = await fetch(url, {
    headers: {
      cookie: session,
      accept: "text/html",
      "sec-fetch-mode": "navigate",
    },
    redirect: "manual",
  });
  assert.equal(r.status, 200);
  const consent = new URL((await r.json()).url, base);
  const approved = await fetch(base + "/api/v1/platform/oauth/consent", {
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
  assert.equal(approved.status, 200, await approved.clone().text());
  await fetch((await approved.json()).url);
}
const oauth = await OAuthSession.login({
  baseUrl: base,
  onAuthorizationUrl: approve,
});
const client = new AgfsClient({ baseUrl: base, token: oauth.token });
assert((await client.whoami()).user);
console.log(
  "SDK browser PKCE callback, exchange, and authenticated API request passed.",
);
// Exercise Python's actual loopback callback and code exchange against the same Worker.
const { spawn } = await import("node:child_process");
const python = spawn(
  "python3",
  [
    "-u",
    "-c",
    `
from agfs_sdk.oauth import OAuthSession
from agfs_sdk import AgfsClient
session=OAuthSession.login(lambda url: print(url,flush=True),base_url='http://localhost:8787')
assert AgfsClient(session.token,base_url='http://localhost:8787').json('/whoami')['user']
print('Python OAuth passed',flush=True)
`,
  ],
  {
    env: { ...process.env, PYTHONPATH: "packages/python-sdk" },
    stdio: ["ignore", "pipe", "inherit"],
  },
);
let pending = "",
  approval;
python.stdout.on("data", (chunk) => {
  pending += chunk;
  let i;
  while ((i = pending.indexOf("\n")) >= 0) {
    const line = pending.slice(0, i);
    pending = pending.slice(i + 1);
    if (line.startsWith(base))
      approval = approve(line).catch((error) => {
        python.kill();
        throw error;
      });
    else console.log(line);
  }
});
await new Promise((resolve, reject) => {
  python.on("error", reject);
  python.on("exit", (code) =>
    code === 0 ? resolve() : reject(new Error("Python OAuth failed")),
  );
});
await approval;
