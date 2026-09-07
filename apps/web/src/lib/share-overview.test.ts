import { describe, it, expect } from "vitest";
import { shareStatus, filterShares } from "./share-overview";
const now = Date.parse("2026-09-07T12:00:00Z"),
  share = {
    id: "s",
    path: "/Report",
    url: "https://example.invalid",
    expiresAt: "2026-09-07T13:00:00Z",
    revokedAt: null,
  };
describe("share review", () => {
  it("distinguishes expired revoked and active links at the exact boundary", () => {
    expect(shareStatus(share, now)).toBe("active");
    expect(
      shareStatus({ ...share, expiresAt: new Date(now).toISOString() }, now),
    ).toBe("expired");
    expect(shareStatus({ ...share, revokedAt: "yes" }, now)).toBe("revoked");
    expect(shareStatus({ ...share, expiresAt: "invalid" }, now)).toBe(
      "expired",
    );
  });
  it("combines path and soon-to-expire filters", () => {
    expect(
      filterShares(
        [share],
        { status: "active", path: "report", soon: true },
        now,
      ),
    ).toHaveLength(1);
    expect(
      filterShares([share], { status: "expired", path: "", soon: true }, now),
    ).toHaveLength(0);
  });
});
