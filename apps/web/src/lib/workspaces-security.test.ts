import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ rows: vi.fn(), first: vi.fn() }));
vi.mock("./platform-db", () => mocks);
vi.mock("./bindings", () => ({ requireResourceBindings: vi.fn() }));
import { listWorkspaces } from "./workspaces";
import type { RequestAuth } from "./authz";
const user = { id: "alice", email: "alice@example.test", name: "Alice" };
beforeEach(() => vi.clearAllMocks());
it("does not expose actor workspace metadata to personal or workspace tokens", async () => {
  for (const workspace of [undefined, "ws_other"]) {
    const auth: RequestAuth = {
      authSource: "api-token",
      user,
      actor: user,
      workspaceId: workspace,
      pathPrefix: "/limited",
      permissions: ["read"],
    };
    await expect(listWorkspaces(auth)).rejects.toMatchObject({ status: 403 });
  }
  expect(mocks.rows).not.toHaveBeenCalled();
});
it("keeps browser workspace switching available", async () => {
  mocks.rows.mockResolvedValue([{ id: "ws_team", name: "Team" }]);
  await expect(
    listWorkspaces({ authSource: "session", user }),
  ).resolves.toEqual([{ id: "ws_team", name: "Team" }]);
});
