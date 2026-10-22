import { readFileSync } from "node:fs";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import type { SQL } from "drizzle-orm";
import { SQLiteSyncDialect } from "drizzle-orm/sqlite-core";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { RequestAuth } from "./authz";
import { encodeCursor } from "./cursor";

const mocks = vi.hoisted(() => ({ rows: vi.fn() }));
vi.mock("./platform-db", () => ({ rows: mocks.rows }));
import { duplicatesApi } from "./duplicates-api";

const alice: RequestAuth = {
  authSource: "session",
  user: { id: "alice", email: "alice@example.test", name: "Alice" },
};
type DuplicatePage = {
  path: string;
  groups: Array<{
    etag: string;
    size: number;
    count: number;
    extraBytes: number;
    files: Array<{ id: string; path: string }>;
  }>;
  nextCursor: string | null;
};
let database: DatabaseSync;
let reads: Array<{ sql: string; params: SQLInputValue[]; returned: number }>;

beforeEach(() => {
  database = new DatabaseSync(":memory:");
  database.exec("PRAGMA foreign_keys=ON");
  for (const name of ["0000_initial.sql", "0011_duplicate_index.sql"])
    database.exec(
      readFileSync(
        new URL(
          `../../../../packages/db/src/migrations/${name}`,
          import.meta.url,
        ),
        "utf8",
      ),
    );
  database.exec(
    "INSERT INTO user(id,email) VALUES ('alice','alice@example.test'),('bob','bob@example.test')",
  );
  reads = [];
  mocks.rows.mockReset();
  mocks.rows.mockImplementation(async (statement: SQL) => {
    const query = new SQLiteSyncDialect().sqlToQuery(statement);
    const params = query.params as SQLInputValue[];
    const result = database.prepare(query.sql).all(...params);
    reads.push({ sql: query.sql, params, returned: result.length });
    return result;
  });
});
afterEach(() => database.close());

function addFile(
  id: string,
  path: string,
  {
    owner = "alice",
    etag = "hash",
    size = 10,
    kind = "file",
  }: {
    owner?: string;
    etag?: string | null;
    size?: number | null;
    kind?: string;
  } = {},
) {
  database
    .prepare(
      "INSERT INTO entries(id,owner_id,path,name,kind,size,etag) VALUES (?,?,?,?,?,?,?)",
    )
    .run(id, owner, path, path.split("/").at(-1)!, kind, size, etag);
}
function request(path?: string, cursor?: string) {
  const url = new URL("https://agfs.test/storage/duplicates");
  if (path !== undefined) url.searchParams.set("path", path);
  if (cursor !== undefined) url.searchParams.set("cursor", cursor);
  return new Request(url);
}
async function list(path?: string, cursor?: string, auth = alice) {
  const response = await duplicatesApi(
    request(path, cursor),
    auth,
    "/storage/duplicates",
  );
  expect(response?.status).toBe(200);
  expect(response?.headers.get("cache-control")).toBe("no-store");
  return response!.json() as Promise<DuplicatePage>;
}

it("pages 21 groups in two reads, returning at most 50 ordered files per group with full counts", async () => {
  // Shared hashes with different sizes exercise both the join key and cursor
  // tie-breaker. Quotes and backslashes must survive the bound JSON parameter.
  const etag = "hash\"\\with'quotes";
  const path = (group: number, file: number) =>
    `/scope/${String(group).padStart(2, "0")}/${String(file).padStart(2, "0")}`;
  for (let group = 21; group >= 1; group--)
    for (let file = 54; file >= 0; file--)
      addFile(`${group}:${file}`, path(group, file), { etag, size: group });

  const first = await list("/scope");
  expect(first).toEqual({
    path: "/scope",
    groups: Array.from({ length: 20 }, (_, index) => ({
      etag,
      size: index + 1,
      count: 55,
      extraBytes: 54 * (index + 1),
      files: Array.from({ length: 50 }, (_, file) => ({
        id: `${index + 1}:${file}`,
        path: path(index + 1, file),
      })),
    })),
    nextCursor: encodeCursor({
      etag,
      size: 20,
      scope: JSON.stringify(["alice", "/scope"]),
    }),
  });
  expect(reads).toHaveLength(2);
  expect(reads.map((read) => read.returned)).toEqual([21, 20]);
  expect(reads[1].params).toHaveLength(5);
  expect(JSON.parse(reads[1].params.at(-1) as string)).toEqual(
    Array.from({ length: 20 }, (_, index) => [etag, index + 1]),
  );
  expect(reads[1].sql).not.toContain(etag);
  const plan = database.prepare(`EXPLAIN QUERY PLAN ${reads[1].sql}`).all(...reads[1].params);
  expect(plan.some((row) => String(row.detail).includes("entries_duplicate_lookup (owner_id=? AND etag=? AND size=?)"))).toBe(true);

  reads = [];
  const second = await list("/scope", first.nextCursor!);
  expect(second).toEqual({
    path: "/scope",
    groups: [
      {
        etag,
        size: 21,
        count: 55,
        extraBytes: 54 * 21,
        files: Array.from({ length: 50 }, (_, file) => ({
          id: `21:${file}`,
          path: path(21, file),
        })),
      },
    ],
    nextCursor: null,
  });
  expect(reads.map((read) => read.returned)).toEqual([1, 1]);
});

it("preserves SQLite group and path ordering, including case and Unicode", async () => {
  const etags = ["a", "é", "Z", "A"];
  const paths = ["é", "a", "Z", "A"];
  for (const etag of etags)
    for (const name of paths)
      addFile(`${etag}:${name}`, `/${etag}/${name}`, { etag });
  const page = await list();
  expect(page.path).toBe("/");
  expect(page.groups.map((group) => group.etag)).toEqual(["A", "Z", "a", "é"]);
  for (const group of page.groups)
    expect(group.files.map((file) => file.path)).toEqual(
      ["A", "Z", "a", "é"].map((name) => `/${group.etag}/${name}`),
    );
  expect(page.nextCursor).toBeNull();
  expect(reads).toHaveLength(2);
});

it("isolates counts and files from other owners with the same hash and size", async () => {
  addFile("alice-b", "/scope/b");
  addFile("alice-a", "/scope/a");
  addFile("bob-a", "/scope/a", { owner: "bob" });
  addFile("bob-b", "/scope/b", { owner: "bob" });
  addFile("alice-only", "/scope/single", { etag: "single" });
  addFile("bob-only", "/scope/single", { owner: "bob", etag: "single" });
  const page = await list("/scope");
  expect(page.groups).toEqual([
    {
      etag: "hash",
      size: 10,
      count: 2,
      extraBytes: 10,
      files: [
        { id: "alice-a", path: "/scope/a" },
        { id: "alice-b", path: "/scope/b" },
      ],
    },
  ]);
  expect(reads.map((read) => read.returned)).toEqual([1, 1]);
});

it.each([
  ["/100%", "/100x"],
  ["/under_score", "/underXscore"],
  ["/Case", "/case"],
  ["/é%_", "/éXY"],
])(
  "matches %s literally in both group counts and file selection",
  async (path, neighbor) => {
    addFile("exact", path);
    addFile("nested", `${path}/nested/file`);
    for (const outside of [neighbor, `${path}suffix`]) {
      addFile(`${outside}:a`, `${outside}/a`);
      addFile(`${outside}:b`, `${outside}/b`);
      addFile(`${outside}:only-a`, `${outside}/only-a`, { etag: "outside" });
      addFile(`${outside}:only-b`, `${outside}/only-b`, { etag: "outside" });
    }
    const scoped: RequestAuth = {
      ...alice,
      authSource: "api-token",
      pathPrefix: path,
      permissions: ["read"],
    };
    const page = await list(undefined, undefined, scoped);
    expect(page).toEqual({
      path,
      groups: [
        {
          etag: "hash",
          size: 10,
          count: 2,
          extraBytes: 10,
          files: [
            { id: "exact", path },
            { id: "nested", path: `${path}/nested/file` },
          ],
        },
      ],
      nextCursor: null,
    });
    expect(reads.map((read) => read.returned)).toEqual([1, 1]);
  },
);

it("excludes folders, empty files, placeholder hashes and singletons", async () => {
  addFile("a", "/a");
  addFile("b", "/b");
  addFile("folder", "/folder", { kind: "folder" });
  addFile("singleton", "/single", { etag: "single" });
  const invalid = [
    { etag: null },
    { etag: "" },
    { etag: "uploaded" },
    { size: 0 },
    { size: -1 },
    { size: null },
  ];
  for (let index = 0; index < invalid.length; index++)
    for (let copy = 0; copy < 2; copy++)
      addFile(
        `invalid:${index}:${copy}`,
        `/invalid/${index}/${copy}`,
        invalid[index],
      );
  expect((await list()).groups).toEqual([
    {
      etag: "hash",
      size: 10,
      count: 2,
      extraBytes: 10,
      files: [
        { id: "a", path: "/a" },
        { id: "b", path: "/b" },
      ],
    },
  ]);
  expect(reads.map((read) => read.returned)).toEqual([1, 1]);
});

it("returns exactly 20 groups without an extra cursor", async () => {
  for (let group = 1; group <= 20; group++)
    for (let file = 0; file < 2; file++)
      addFile(`${group}:${file}`, `/${group}/${file}`, { size: group });
  const page = await list();
  expect(page.groups).toHaveLength(20);
  expect(page.nextCursor).toBeNull();
  expect(reads.map((read) => read.returned)).toEqual([20, 20]);
});

it("does not issue a file query for an empty or exhausted page", async () => {
  expect(await list()).toEqual({ path: "/", groups: [], nextCursor: null });
  expect(reads.map((read) => read.returned)).toEqual([0]);
  addFile("a", "/a");
  addFile("b", "/b");
  reads = [];
  const cursor = encodeCursor({
    etag: "hash",
    size: 10,
    scope: JSON.stringify(["alice", "/"]),
  });
  expect(await list("/", cursor)).toEqual({
    path: "/",
    groups: [],
    nextCursor: null,
  });
  expect(reads.map((read) => read.returned)).toEqual([0]);
});

it.each([
  { scope: JSON.stringify(["bob", "/scope"]) },
  { scope: JSON.stringify(["alice", "/other"]) },
  { size: 0 },
  { size: 1.5 },
  { etag: "x".repeat(257) },
])(
  "rejects cursors outside their scope or bounds before querying: %j",
  async (override) => {
    const cursor = encodeCursor({
      etag: "hash",
      size: 10,
      scope: JSON.stringify(["alice", "/scope"]),
      ...override,
    });
    await expect(list("/scope", cursor)).rejects.toMatchObject({ status: 400 });
    expect(reads).toHaveLength(0);
  },
);

it("rejects unreadable or out-of-scope paths before querying", async () => {
  const scoped: RequestAuth = {
    ...alice,
    authSource: "api-token",
    pathPrefix: "/Case",
    permissions: ["read"],
  };
  for (const path of ["/", "/case", "/Cases"])
    await expect(list(path, undefined, scoped)).rejects.toMatchObject({
      status: 403,
    });
  await expect(
    list("/Case", undefined, { ...scoped, permissions: [] }),
  ).rejects.toMatchObject({ status: 403 });
  expect(reads).toHaveLength(0);
});
