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

import { commitUpload } from "./fs";

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

  it("deletes the uploaded object and fails when the commit-time quota check rejects it", async () => {
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
      message: "Storage limit reached for the Free plan (1.0 kB). Current usage is 1.0 kB and this upload would use 1.6 kB.",
    });

    const thrown = await commitUpload({ id: "user_1", email: "free@example.com" }, "upl_1", "etag-1").catch((error) => error);

    expect(mocks.getStorageWriteDecisionForUser).toHaveBeenCalledWith({
      user: { id: "user_1", email: "free@example.com" },
      existingFileSizeBytes: 0,
      incomingSizeBytes: 600,
    });
    expect(mocks.remove).toHaveBeenCalledWith(upload.objectKey);
    expect(mocks.updateSet).toHaveBeenCalledWith({ status: "expired" });
    expect(thrown).toBeInstanceOf(Response);
    expect(thrown.status).toBe(403);
    await expect(thrown.json()).resolves.toEqual({
      error: "Storage limit reached for the Free plan (1.0 kB). Current usage is 1.0 kB and this upload would use 1.6 kB.",
    });
  });
});
