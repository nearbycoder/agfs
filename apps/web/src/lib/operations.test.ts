import { it, expect, vi, beforeEach } from "vitest";
const state = vi.hoisted(() => ({
  op: vi.fn(),
  search: vi.fn(),
  missing: false,
}));
vi.mock("./bindings", () => ({
  getBindings: () =>
    state.missing
      ? {}
      : {
          OP_RATE_LIMITER: { limit: state.op },
          SEARCH_RATE_LIMITER: { limit: state.search },
        },
}));
vi.mock("./platform-db", () => ({ first: vi.fn(), rows: vi.fn() }));
import { limitOperation } from "./operations";
const auth = {
  user: { id: "owner" },
  actor: { id: "actor" },
  tokenId: "token",
} as any;
beforeEach(() => {
  state.missing = false;
  state.op.mockReset().mockResolvedValue({ success: true });
  state.search.mockReset().mockResolvedValue({ success: true });
});
it("limits search by owner and token with a separate budget", async () => {
  await limitOperation(
    new Request("https://agfs.dev/api/v1/platform/search"),
    auth,
  );
  expect(state.search.mock.calls).toEqual([
    [{ key: "owner:owner:search" }],
    [{ key: "actor:token:search" }],
  ]);
  expect(state.op).not.toHaveBeenCalled();
});
it("returns 429 and Retry-After when actor budget is exhausted", async () => {
  state.op
    .mockResolvedValueOnce({ success: true })
    .mockResolvedValueOnce({ success: false });
  try {
    await limitOperation(new Request("https://agfs.dev/mcp"), auth);
    throw Error("Expected rejection");
  } catch (r) {
    expect(r).toBeInstanceOf(Response);
    expect((r as Response).status).toBe(429);
    expect((r as Response).headers.get("retry-after")).toBe("60");
  }
});
it("fails closed when rate-limit binding is missing", async () => {
  state.missing = true;
  await expect(
    limitOperation(new Request("https://agfs.dev/api/v1/fs/list"), auth),
  ).rejects.toMatchObject({ status: 503 });
});
