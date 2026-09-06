import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ rows: [] as unknown[], returned: [] as unknown[], insert: vi.fn(), sets: vi.fn() }));
vi.mock("./db", () => ({ db: {
  select: () => ({ from: () => ({ where: async () => mocks.rows }) }),
  update: () => ({ set: (value: unknown) => { mocks.sets(value); return { where: () => ({ returning: async () => mocks.returned }) }; } }),
  insert: mocks.insert,
} }));
vi.mock("./auth", () => ({ auth: { api: {} } }));
vi.mock("./bindings", () => ({ requireStringBindings: () => ({ APP_URL: "https://agfs.dev" }) }));
import { approveDeviceAuthorization, pollDeviceAuthorization } from "./authz";

beforeEach(() => { mocks.rows = []; mocks.returned = []; mocks.insert.mockClear(); mocks.sets.mockClear(); });
it("does not issue a second token when a concurrent approval has claimed the code", async () => {
  mocks.rows = [{ deviceCode: "device", expiresAt: new Date(Date.now() + 60_000), approvedAt: null }];
  await expect(approveDeviceAuthorization("owner", { userCode: "ABCDEF01", label: "cli" })).rejects.toMatchObject({ status: 409 });
  expect(mocks.insert).not.toHaveBeenCalled();
});
it("does not return plaintext to a losing concurrent poll", async () => {
  mocks.rows = [{ deviceCode: "device", expiresAt: new Date(Date.now() + 60_000), approvedAt: new Date(), accessTokenPlaintext: "agfs_secret", consumedAt: null }];
  await expect(pollDeviceAuthorization("device")).resolves.toEqual({ status: "expired" });
  expect(mocks.sets).toHaveBeenCalledWith(expect.objectContaining({ accessTokenPlaintext: null }));
});
it("returns a token only to the successful consumer", async () => {
  mocks.rows = [{ deviceCode: "device", expiresAt: new Date(Date.now() + 60_000), approvedAt: new Date(), accessTokenPlaintext: "agfs_secret", consumedAt: null }];
  mocks.returned = [{ deviceCode: "device" }];
  await expect(pollDeviceAuthorization("device")).resolves.toMatchObject({ status: "approved", accessToken: "agfs_secret" });
});
