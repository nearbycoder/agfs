import { describe, expect, it } from "vitest";
import { formatStorageBytes, renderAccountSummary, renderEntries, renderTree } from "./format";

describe("formatStorageBytes", () => {
  it("renders gigabytes with one decimal place", () => {
    expect(formatStorageBytes(1024 ** 3)).toBe("1.0 GB");
  });
});

describe("renderEntries", () => {
  it("renders a tabular listing", () => {
    expect(
      renderEntries([
        {
          id: "1",
          ownerId: "user_1",
          parentPath: "/",
          path: "/shots",
          name: "shots",
          kind: "folder",
          size: null,
          contentType: null,
          etag: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ]),
    ).toContain("/shots\tfolder\tfolder");
  });
});

describe("renderTree", () => {
  it("renders nested branches", () => {
    expect(
      renderTree([
        {
          id: "folder_1",
          path: "/shots",
          name: "shots",
          kind: "folder",
          size: null,
          children: [
            {
              id: "file_1",
              path: "/shots/a.png",
              name: "a.png",
              kind: "file",
              size: 128,
            },
          ],
        },
      ]),
    ).toContain("shots/");
  });
});

describe("renderAccountSummary", () => {
  it("renders a boxed storage summary with remaining space", () => {
    expect(
      renderAccountSummary({
        planId: "free",
        planName: "Free",
        storageUsedBytes: 256 * 1024 * 1024,
        storageLimitBytes: 1024 ** 3,
        storageRemainingBytes: 768 * 1024 * 1024,
        isOverLimit: false,
        paidPlanComingSoon: true,
      }),
    ).toContain("AGFS storage");
    expect(
      renderAccountSummary({
        planId: "free",
        planName: "Free",
        storageUsedBytes: 256 * 1024 * 1024,
        storageLimitBytes: 1024 ** 3,
        storageRemainingBytes: 768 * 1024 * 1024,
        isOverLimit: false,
        paidPlanComingSoon: true,
      }),
    ).toContain("Left      768.0 MB");
  });

  it("renders an over-limit status when usage is above quota", () => {
    expect(
      renderAccountSummary({
        planId: "paid",
        planName: "Paid",
        storageUsedBytes: 22 * 1024 ** 3,
        storageLimitBytes: 20 * 1024 ** 3,
        storageRemainingBytes: 0,
        isOverLimit: true,
        paidPlanComingSoon: true,
      }),
    ).toContain("Over by 2.0 GB");
  });
});
