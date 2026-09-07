import assert from "node:assert/strict";
import { cookie, database } from "./platform-fixtures.mjs";
import { AgfsClient } from "../packages/sdk/dist/index.js";
const base = "http://localhost:8787",
  alice = cookie(),
  bob = cookie("bob"),
  root = "/platform-" + Date.now();
let checks = 0;
async function req(
  path,
  {
    session = alice,
    token,
    workspace,
    status = 200,
    method,
    body,
    headers = {},
  } = {},
) {
  const r = await fetch(base + path, {
    method: method ?? (body === undefined ? "GET" : "POST"),
    headers: {
      ...(token ? { authorization: "Bearer " + token } : { cookie: session }),
      ...(workspace ? { "x-agfs-workspace": workspace } : {}),
      ...(body === undefined
        ? {}
        : { "content-type": "application/json", origin: base }),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: "manual",
  });
  assert.equal(r.status, status, `${path}: ${await r.clone().text()}`);
  checks++;
  return r;
}
const json = async (...args) => (await req(...args)).json();
const p = (path, options) => json("/api/v1/platform" + path, options);
async function write(path, text, options = {}) {
  const intent = await json("/api/v1/fs/upload-intents", {
    ...options,
    body: {
      path,
      contentType: "text/plain",
      size: Buffer.byteLength(text),
      ...("ifMatch" in options ? { ifMatch: options.ifMatch } : {}),
    },
  });
  const put = await fetch(intent.url, {
    method: "PUT",
    headers: intent.headers,
    body: text,
  });
  assert.equal(put.status, 200);
  checks++;
  return (
    await json("/api/v1/fs/uploads/" + intent.uploadId + "/commit", {
      ...options,
      body: { etag: "uploaded" },
    })
  ).entry;
}
await req("/api/v1/whoami");
const ws = await p("/workspaces", {
  body: { name: "Platform smoke " + Date.now() },
  status: 201,
});
await req("/api/v1/fs/list", { workspace: ws.id, session: bob, status: 403 });
const invite = await p("/invites", {
  workspace: ws.id,
  body: { email: "bob@example.test", role: "viewer" },
  status: 201,
});
await p("/invites/accept", { body: { token: invite.token }, status: 404 });
await p("/invites/accept", { session: bob, body: { token: invite.token } });
await p("/invites/accept", {
  session: bob,
  body: { token: invite.token },
  status: 404,
});
await write(root + "/one.txt", "searchable nebula", {
  workspace: ws.id,
  ifMatch: null,
});
await req("/api/v1/fs/list?path=" + root, { workspace: ws.id, session: bob });
await req("/api/v1/fs/mkdir", {
  workspace: ws.id,
  session: bob,
  body: { path: root + "/forbidden" },
  status: 403,
});
const tok = await json("/api/v1/tokens", {
  workspace: ws.id,
  body: {
    label: "Scoped agent",
    pathPrefix: root,
    permissions: ["read", "write", "delete"],
  },
});
await req("/api/v1/fs/list?path=" + root, { token: tok.token });
await req("/api/v1/fs/list?path=/", { token: tok.token, status: 403 });
await req("/api/v1/fs/list?path=" + root, {
  token: tok.token,
  workspace: "personal",
  status: 403,
});
const current = (
  await json("/api/v1/fs/list?path=" + root, { token: tok.token })
).entries[0];
await write(root + "/one.txt", "changed", {
  token: tok.token,
  ifMatch: current.etag,
});
await req("/api/v1/fs/upload-intents", {
  token: tok.token,
  body: {
    path: root + "/one.txt",
    size: 3,
    contentType: "text/plain",
    ifMatch: current.etag,
  },
  status: 409,
});
// Concurrent prepared writes with the same base can only commit once.
const file = await write(root + "/race.txt", "base", {
  token: tok.token,
  ifMatch: null,
});
const intents = await Promise.all(
  [1, 2].map(() =>
    json("/api/v1/fs/upload-intents", {
      token: tok.token,
      body: {
        path: file.path,
        size: 3,
        contentType: "text/plain",
        ifMatch: file.etag,
      },
    }),
  ),
);
for (const i of intents)
  assert.equal(
    (await fetch(i.url, { method: "PUT", headers: i.headers, body: "new" }))
      .status,
    200,
  );
const race = await Promise.all(
  intents.map((i) =>
    fetch(base + "/api/v1/fs/uploads/" + i.uploadId + "/commit", {
      method: "POST",
      headers: {
        authorization: "Bearer " + tok.token,
        "content-type": "application/json",
      },
      body: '{"etag":"uploaded"}',
    }),
  ),
);
assert.deepEqual(race.map((r) => r.status).sort(), [200, 409]);
checks++;
await p("/tags", {
  token: tok.token,
  method: "PUT",
  body: { path: root + "/race.txt", tags: ["approved", "release"] },
});
await write(root + "/indexed.txt", "quasar constellation", {
  token: tok.token,
  ifMatch: null,
});
// Limit this manual cron pass to the new fixture's index queue; do not deliver external webhooks.
database
  .prepare(
    "DELETE FROM index_jobs WHERE entry_id NOT IN (SELECT id FROM entries WHERE owner_id=?)",
  )
  .run(ws.id);
database.exec("UPDATE webhooks SET enabled=0");
assert.equal((await fetch(base + "/cdn-cgi/local/scheduled")).status, 200);
const found = await p("/search?q=quasar", { token: tok.token });
assert(found.results.some((f) => f.path.endsWith("indexed.txt")));
checks++;
assert(
  (await p("/search?tag=approved", { token: tok.token })).results.some((f) =>
    f.path.endsWith("race.txt"),
  ),
);
checks++;
assert.equal((await p("/search?q=quasar", { session: bob })).results.length, 0);
checks++;
const run = await p("/runs", {
  token: tok.token,
  body: {
    name: "Build",
    path: root,
    inputs: [root + "/indexed.txt"],
    metadata: { revision: "abc123" },
  },
  status: 201,
});
const completed = await p("/runs/" + run.id + "/complete", {
  token: tok.token,
  body: {},
});
assert(completed.manifest.artifacts.length >= 3);
assert.equal(completed.manifest.inputs.length, 1);
checks += 2;
await p("/runs/" + run.id, { session: bob, status: 404 });
const draft = await p("/drafts", {
  token: tok.token,
  body: { name: "Proposed edit", path: root },
  status: 201,
});
await p("/drafts/" + draft.id + "/changes", {
  token: tok.token,
  method: "PUT",
  body: {
    path: root + "/indexed.txt",
    operation: "write",
    content: "reviewed quasar",
  },
});
await p("/drafts/" + draft.id + "/review", {
  token: tok.token,
  body: { accept: true },
  status: 403,
});
await p("/drafts/" + draft.id + "/apply", {
  token: tok.token,
  body: {},
  status: 409,
});
await p("/drafts/" + draft.id + "/review", {
  workspace: ws.id,
  body: { accept: true },
});
await p("/drafts/" + draft.id + "/changes", {
  token: tok.token,
  method: "PUT",
  body: {
    path: root + "/indexed.txt",
    operation: "write",
    content: "bypass approval",
  },
  status: 409,
});
await p("/drafts/" + draft.id + "/apply", { token: tok.token, body: {} });
assert.equal(
  await (
    await req("/api/v1/fs/download?path=" + root + "/indexed.txt", {
      token: tok.token,
    })
  ).text(),
  "reviewed quasar",
);
checks++;
const conflict = await p("/drafts", {
  token: tok.token,
  body: { name: "Conflicting edit", path: root },
  status: 201,
});
for (const file of ["indexed.txt", "one.txt"])
  await p("/drafts/" + conflict.id + "/changes", {
    token: tok.token,
    method: "PUT",
    body: {
      path: root + "/" + file,
      operation: "write",
      content: "should not apply",
    },
  });
await p("/drafts/" + conflict.id + "/review", {
  workspace: ws.id,
  body: { accept: true },
});
await write(root + "/one.txt", "independent edit", { token: tok.token });
await p("/drafts/" + conflict.id + "/apply", {
  token: tok.token,
  body: {},
  status: 409,
});
assert.equal(
  await (
    await req("/api/v1/fs/download?path=" + root + "/indexed.txt", {
      token: tok.token,
    })
  ).text(),
  "reviewed quasar",
);
checks++;
// Creating a webhook is local only; disable before generating a matching event and never run delivery against it.
for (const url of [
  "http://example.com",
  "https://127.0.0.1",
  "https://[::1]",
  "https://service.internal",
])
  await p("/webhooks", {
    workspace: ws.id,
    body: { url, path: root, events: ["*"] },
    status: 400,
  });
const hook = await p("/webhooks", {
  workspace: ws.id,
  body: {
    url: "https://hooks.agfs.dev/test",
    path: root,
    events: ["upload.commit"],
  },
  status: 201,
});
assert(hook.secret);
checks++;
await write(root + "/event.txt", "webhook event", { token: tok.token });
const deliveries = await p("/webhooks/" + hook.id + "/deliveries", {
  workspace: ws.id,
});
assert.equal(deliveries.deliveries.length, 1);
checks++;
await p("/webhooks/" + hook.id, {
  workspace: ws.id,
  method: "PATCH",
  body: { enabled: false },
});
await p("/webhooks/" + hook.id + "/deliveries", { session: bob });
let usage = (await p("/budgets", { workspace: ws.id })).agents.find(
  (t) => t.id === tok.record.id,
);
assert(
  usage.operations > 0 && usage.upload_bytes > 0 && usage.storage_bytes > 0,
);
checks++;
await p("/budgets/" + tok.record.id, {
  workspace: ws.id,
  method: "PUT",
  body: {
    paused: false,
    storageLimit: null,
    uploadLimit: null,
    operationLimit: usage.operations + 1,
  },
});
await req("/api/v1/fs/list?path=" + root, { token: tok.token });
await req("/api/v1/fs/list?path=" + root, { token: tok.token, status: 429 });
await p("/budgets/" + tok.record.id, {
  workspace: ws.id,
  method: "PUT",
  body: {
    paused: true,
    storageLimit: null,
    uploadLimit: null,
    operationLimit: null,
  },
});
await req("/api/v1/fs/list?path=" + root, { token: tok.token, status: 401 });
await p("/budgets/" + tok.record.id, {
  workspace: ws.id,
  method: "PUT",
  body: {
    paused: false,
    storageLimit: null,
    uploadLimit: 0,
    operationLimit: null,
  },
});
await req("/api/v1/fs/upload-intents", {
  token: tok.token,
  body: { path: root + "/budget", size: 1, contentType: "text/plain" },
  status: 409,
});
await p("/members", {
  workspace: ws.id,
  method: "PATCH",
  body: { userId: "bob", role: null },
});
await req("/api/v1/fs/list?path=" + root, {
  workspace: ws.id,
  session: bob,
  status: 403,
});
await p("/members", {
  workspace: ws.id,
  method: "PATCH",
  body: { userId: "alice", role: null },
  status: 409,
});
await p("/workspace", {
  workspace: ws.id,
  method: "PATCH",
  body: { name: ws.name, paused: true, storageLimit: 1073741824 },
});
await req("/api/v1/fs/mkdir", {
  workspace: ws.id,
  body: { path: "/paused" },
  status: 403,
});
await req("/api/v1/fs/list?path=" + root, { workspace: ws.id });
console.log("Platform smoke passed:", checks, "checks.");
