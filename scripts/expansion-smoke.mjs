import assert from "node:assert/strict";
import { cookie } from "./platform-fixtures.mjs";
import { AgfsClient } from "../packages/sdk/dist/index.js";
const base = "http://localhost:8787",
  alice = cookie(),
  bob = cookie("bob");
const client = new AgfsClient({
  token: "agfs_local_test_alice",
  baseUrl: base,
});
const root = "/expansion-" + Date.now();
let checks = 0;
async function api(
  path,
  { method = "GET", body, session = alice, status = 200, workspace } = {},
) {
  const response = await fetch(base + "/api/v1/platform" + path, {
    method,
    headers: {
      cookie: session,
      origin: base,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      ...(workspace ? { "x-agfs-workspace": workspace } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  assert.equal(
    response.status,
    status,
    path + ": " + (await response.clone().text()),
  );
  checks++;
  return response.json();
}
await client.mkdir(root);
await client.upload(root + "/favorite.txt", new Blob(["favorite"]));
await api("/favorites", {
  method: "PUT",
  body: { path: root + "/favorite.txt" },
});
assert(
  (await api("/favorites")).favorites.some(
    (f) => f.path === root + "/favorite.txt",
  ),
);
checks++;
assert(
  !(await api("/favorites", { session: bob })).favorites.some(
    (f) => f.path === root + "/favorite.txt",
  ),
);
checks++;
await api("/favorites", {
  method: "PUT",
  body: { path: root + "/favorite.txt" },
  session: bob,
  status: 404,
});
await client.move(root + "/favorite.txt", root + "/renamed.txt");
assert(
  (await api("/favorites")).favorites.some(
    (f) => f.path === root + "/renamed.txt",
  ),
);
checks++;
await api("/favorites", {
  method: "DELETE",
  body: { path: root + "/renamed.txt" },
});
assert(
  !(await api("/favorites")).favorites.some(
    (f) => f.path === root + "/renamed.txt",
  ),
);
checks++;
const workspace = await api("/workspaces", {
  method: "POST",
  body: { name: "Expansion tests" },
  status: 201,
});
assert.equal(
  (await api("/favorites", { workspace: workspace.id })).favorites.length,
  0,
);
checks++;
const saved = await api("/saved-searches", {
  method: "POST",
  body: {
    name: "Report files",
    filters: { q: "report", path: root, type: "text/plain", tag: "release" },
  },
  status: 201,
});
assert.equal(
  (await api("/saved-searches")).searches.find((s) => s.id === saved.id).filters
    .tag,
  "release",
);
checks++;
await api("/saved-searches", {
  method: "POST",
  body: { name: "report files", filters: {} },
  status: 409,
});
await api("/saved-searches/" + saved.id, {
  method: "PATCH",
  body: { name: "Renamed report search" },
});
await api("/saved-searches/" + saved.id, {
  method: "DELETE",
  session: bob,
  status: 404,
});
assert.equal(
  (await api("/saved-searches", { workspace: workspace.id })).searches.length,
  0,
);
checks++;
await api("/saved-searches/" + saved.id, { method: "DELETE" });
assert(!(await api("/saved-searches")).searches.some((s) => s.id === saved.id));
checks++;
await api("/saved-searches", {
  method: "POST",
  body: { name: "", filters: {} },
  status: 400,
});
console.log(`Expansion checks passed: ${checks}`);
