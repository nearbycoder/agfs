import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const selectResults: Array<Array<unknown>> = [];
  const select = vi.fn(() => ({
    from: vi.fn(() => ({
      where: vi.fn(() => Promise.resolve(selectResults.shift() ?? [])),
    })),
  }));
  const updateSet = vi.fn(() => ({
    where: vi.fn(() => Promise.resolve()),
  }));
  const update = vi.fn(() => ({
    set: updateSet,
  }));
  const head = vi.fn();
  const remove = vi.fn();
  const getStorageWriteDecisionForUser = vi.fn();

  return {
    selectResults,
    select,
    update,
    updateSet,
    head,
    remove,
    getStorageWriteDecisionForUser,
  };
});

vi.mock("./atomic-batch", () => ({ atomicBatch: vi.fn(async () => []) }));

vi.mock("./db", () => ({
  db: {
    select: mocks.select,
    update: mocks.update,
  },
}));

vi.mock("./bindings", () => ({
  requireResourceBindings: vi.fn(() => ({
    FILES_BUCKET: {
      head: mocks.head,
      delete: mocks.remove,
    },
  })),
}));

vi.mock("./account", () => ({
  getStorageWriteDecisionForUser: mocks.getStorageWriteDecisionForUser,
}));

import { commitUpload, moveEntry } from "./fs";

describe("commitUpload quota recheck", () => {
  beforeEach(() => {
    mocks.selectResults.length = 0;
    mocks.select.mockClear();
    mocks.update.mockClear();
    mocks.updateSet.mockClear();
    mocks.head.mockReset();
    mocks.remove.mockReset();
    mocks.getStorageWriteDecisionForUser.mockReset();
  });

  it("preserves the object for safe cleanup and fails when the commit-time quota check rejects it", async () => {
    const upload = {
      id: "upl_1",
      ownerId: "user_1",
      path: "/artifact.png",
      contentType: "image/png",
      size: 600,
      objectKey: "u/user_1/f/ent_1/ver_1",
      uploadTokenHash: "hash",
      status: "pending",
      createdAt: new Date("2026-03-29T00:00:00.000Z"),
      expiresAt: new Date(Date.now() + 60_000),
      committedAt: null,
    };

    mocks.selectResults.push([upload], []);
    mocks.head.mockResolvedValue({ size: 600, etag: "etag-1" });
    mocks.remove.mockResolvedValue(undefined);
    mocks.getStorageWriteDecisionForUser.mockResolvedValue({
      allowed: false,
      currentUsageBytes: 1024,
      projectedUsageBytes: 1600,
      storageLimitBytes: 1024,
      isOverLimit: false,
      message:
        "Storage limit reached for the Free plan (1.0 kB). Current usage is 1.0 kB and this upload would use 1.6 kB.",
    });

    const thrown = await commitUpload({ id: "user_1", email: "free@example.com" }, "upl_1", "etag-1").catch(
      (error) => error,
    );

    expect(mocks.getStorageWriteDecisionForUser).toHaveBeenCalledWith({
      user: { id: "user_1", email: "free@example.com" },
      existingFileSizeBytes: 0,
      incomingSizeBytes: 600,
    });
    expect(mocks.remove).not.toHaveBeenCalled();
    expect(mocks.updateSet).toHaveBeenCalledWith({ status: "expired" });
    expect(thrown).toBeInstanceOf(Response);
    expect(thrown.status).toBe(403);
    await expect(thrown.json()).resolves.toEqual({
      error:
        "Storage limit reached for the Free plan (1.0 kB). Current usage is 1.0 kB and this upload would use 1.6 kB.",
    });
  });
});

import { DatabaseSync } from "node:sqlite";
import { SQLiteSyncDialect } from "drizzle-orm/sqlite-core";
import { descendantPathCondition } from "./fs";

it("matches literal, case-sensitive folder prefixes in SQLite", () => {
  const db = new DatabaseSync(":memory:");
  db.exec(
    "CREATE TABLE entries (path TEXT); INSERT INTO entries VALUES ('/a_b/file'), ('/axb/file'), ('/a%b/file'), ('/AB/file'), ('/ab/file')",
  );
  for (const pathname of ["/a_b", "/a%b", "/AB", "/ab"]) {
    const query = new SQLiteSyncDialect().sqlToQuery(descendantPathCondition(pathname));
    const rows = db.prepare(`SELECT path FROM entries WHERE ${query.sql}`).all(...(query.params as any[]));
    expect(rows.map((row) => row.path)).toEqual([`${pathname}/file`]);
  }
  db.close();
});

it("rejects a committed upload before inspecting or deleting its stored object", async () => {
  mocks.selectResults.push([{ id: "u", status: "committed" }]);
  mocks.head.mockClear();
  await expect(commitUpload({ id: "owner", email: "a@example.com" }, "u", "etag")).rejects.toMatchObject({
    status: 409,
  });
  expect(mocks.head).not.toHaveBeenCalled();
});

it("moves descendants without interpreting dollar sequences in destination names", async () => {
  mocks.selectResults.length = 0;
  mocks.updateSet.mockClear();
  const source = { id: "folder", ownerId: "owner", path: "/from", kind: "folder" };
  mocks.selectResults.push(
    [source],
    [],
    [],
    [source, { id: "child", ownerId: "owner", path: "/from/child", kind: "file" }],
  );
  await moveEntry("owner", "/from", "/$&");
  expect(mocks.updateSet).toHaveBeenCalledWith(expect.objectContaining({ path: "/$&/child" }));
});
