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
  {
    method = "GET",
    body,
    session = alice,
    status = 200,
    workspace,
    token,
  } = {},
) {
  const response = await fetch(base + "/api/v1/platform" + path, {
    method,
    headers: {
      ...(token ? { authorization: "Bearer " + token } : { cookie: session }),
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
const notePath = root + "/renamed.txt";
const emptyNotes = await api("/notes?path=" + encodeURIComponent(notePath));
assert.equal(emptyNotes.note, null);
checks++;
const noteBody = {
  path: notePath,
  entryId: emptyNotes.entry.id,
  body: "Initial shared note",
  revision: 0,
};
const note = await api("/notes", { method: "PUT", body: noteBody });
assert.equal(note.note.revision, 1);
checks++;
await api("/notes", {
  method: "PUT",
  body: { ...noteBody, body: "Stale overwrite" },
  status: 409,
});
await api("/notes", {
  method: "PUT",
  body: { ...noteBody, revision: 1, entryId: "other" },
  status: 409,
});
await api("/notes?path=" + encodeURIComponent(notePath), {
  session: bob,
  status: 404,
});
await api("/notes", {
  method: "PUT",
  body: { ...noteBody, revision: 1, body: "" },
});
assert.equal(
  (await api("/notes?path=" + encodeURIComponent(notePath))).note.revision,
  2,
);
checks++;
await api("/notes", {
  method: "PUT",
  body: { ...noteBody, revision: 2, body: "x".repeat(4001) },
  status: 400,
});
await client.move(notePath, root + "/noted.txt");
assert.equal(
  (await api("/notes?path=" + encodeURIComponent(root + "/noted.txt"))).note
    .revision,
  2,
);
checks++;
const readerResponse = await fetch(base + "/api/v1/tokens", {
  method: "POST",
  headers: { cookie: alice, origin: base, "content-type": "application/json" },
  body: JSON.stringify({
    label: "Expansion reader",
    pathPrefix: root,
    permissions: ["read"],
    ttl: "1d",
  }),
});
assert.equal(readerResponse.status, 200);
checks++;
const reader = (await readerResponse.json()).token;
assert.equal(
  (
    await api("/notes?path=" + encodeURIComponent(root + "/noted.txt"), {
      token: reader,
    })
  ).canEdit,
  false,
);
checks++;
await api("/notes", {
  method: "PUT",
  token: reader,
  body: { ...noteBody, path: root + "/noted.txt", revision: 2 },
  status: 403,
});
await api("/notes?path=/outside-scope", { token: reader, status: 403 });
const collection = await api("/collections", {
  method: "POST",
  body: { name: "Handoff files" },
  status: 201,
});
await api("/collections", {
  method: "POST",
  body: { name: "handoff files" },
  status: 409,
});
const collectionPath = "/collections/" + collection.id;
await api(collectionPath + "/items", {
  method: "PUT",
  body: { path: root + "/noted.txt" },
});
await api(collectionPath + "/items", {
  method: "PUT",
  body: { path: root + "/noted.txt" },
});
assert.equal((await api(collectionPath + "/items")).items.length, 1);
checks++;
await api(collectionPath + "/items", { session: bob, status: 404 });
await api(collectionPath, {
  method: "DELETE",
  workspace: workspace.id,
  status: 404,
});
await api(collectionPath, {
  method: "PATCH",
  body: { name: "Reviewed files" },
});
await client.move(root + "/noted.txt", root + "/collected.txt");
const member = (await api(collectionPath + "/items")).items[0];
assert.equal(member.path, root + "/collected.txt");
checks++;
await api(collectionPath + "/items", {
  method: "DELETE",
  body: { entryId: member.id },
});
assert.equal((await api(collectionPath + "/items")).items.length, 0);
checks++;
await api(collectionPath + "/items", {
  method: "PUT",
  body: { path: root + "/collected.txt" },
});
await api(collectionPath, { method: "DELETE" });
assert.equal(await client.readText(root + "/collected.txt"), "favorite");
checks++;
await api(collectionPath + "/items", { status: 404 });
const searchBase = "/search?path=" + encodeURIComponent(root);
assert.equal(
  (await api(searchBase + "&kind=file&minSize=8")).results.length,
  1,
);
checks++;
assert.equal(
  (await api(searchBase + "&kind=file&maxSize=7")).results.length,
  0,
);
checks++;
assert(
  (await api(searchBase + "&kind=folder")).results.every(
    (e) => e.kind === "folder",
  ),
);
checks++;
assert.equal((await api(searchBase + "&modifiedBefore=1")).results.length, 0);
checks++;
assert((await api(searchBase + "&modifiedAfter=1")).results.length > 0);
checks++;
await api(searchBase + "&minSize=20&maxSize=1", { status: 400 });
await api(searchBase + "&modifiedAfter=20&modifiedBefore=1", { status: 400 });
await api(searchBase, { token: reader });
await api("/search?path=/&minSize=0", { token: reader, status: 403 });
const advancedSaved = await api("/saved-searches", {
  method: "POST",
  body: {
    name: "Large text",
    filters: {
      path: root,
      q: "",
      kind: "file",
      minSize: "8",
      after: "2026-01-01",
    },
  },
  status: 201,
});
assert.equal(
  (await api("/saved-searches")).searches.find((s) => s.id === advancedSaved.id)
    .filters.minSize,
  "8",
);
checks++;
for (let index = 0; index < 51; index++)
  await client.mkdir(root + "/pages/" + String(index).padStart(3, "0"));
const pageQuery =
  "/search?path=" + encodeURIComponent(root + "/pages") + "&kind=folder";
const firstPage = await api(pageQuery);
assert.equal(firstPage.results.length, 50);
assert(firstPage.nextCursor);
checks += 2;
const secondPage = await api(
  pageQuery + "&cursor=" + encodeURIComponent(firstPage.nextCursor),
);
assert.equal(
  new Set([...firstPage.results, ...secondPage.results].map((e) => e.id)).size,
  52,
);
checks++;
await api(
  pageQuery + "&maxSize=10&cursor=" + encodeURIComponent(firstPage.nextCursor),
  { status: 400 },
);
const storage = await api("/storage/insights?path=" + encodeURIComponent(root));
assert.equal(storage.summary.bytes, 8);
assert.equal(storage.summary.files, 1);
checks += 2;
assert.equal(
  storage.types.reduce((sum, t) => sum + t.bytes, 0),
  8,
);
checks++;
assert.equal(storage.largest[0].path, root + "/collected.txt");
checks++;
assert.equal(
  (await api("/storage/insights?path=" + encodeURIComponent(root + "/pages")))
    .summary.bytes,
  0,
);
checks++;
await api("/storage/insights?path=" + encodeURIComponent(root), {
  session: bob,
  status: 404,
});
await api(
  "/storage/insights?path=" + encodeURIComponent(root + "/collected.txt"),
  { status: 400 },
);
await api("/storage/insights?path=/", { token: reader, status: 403 });
assert.equal(
  (await api("/storage/insights", { token: reader })).summary.bytes,
  8,
);
checks++;
await client.upload(root + "/duplicate.txt", new Blob(["favorite"]));
const duplicates = await api(
  "/storage/duplicates?path=" + encodeURIComponent(root),
);
assert.equal(duplicates.groups.length, 1);
assert.equal(duplicates.groups[0].count, 2);
assert.equal(duplicates.groups[0].extraBytes, 8);
checks += 3;
assert.deepEqual(
  duplicates.groups[0].files.map((f) => f.path).sort(),
  [root + "/collected.txt", root + "/duplicate.txt"].sort(),
);
checks++;
assert.equal(
  (
    await api("/storage/duplicates?path=" + encodeURIComponent(root), {
      session: bob,
    })
  ).groups.length,
  0,
);
checks++;
await api("/storage/duplicates?path=/", { token: reader, status: 403 });
assert.equal(
  (await api("/storage/duplicates", { token: reader })).groups.length,
  1,
);
checks++;
await client.upload(root + "/duplicate.txt", new Blob(["different"]));
assert.equal(
  (await api("/storage/duplicates?path=" + encodeURIComponent(root))).groups
    .length,
  0,
);
checks++;
console.log(`Expansion checks passed: ${checks}`);
