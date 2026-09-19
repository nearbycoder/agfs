import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ first: vi.fn(), rows: vi.fn() }));
vi.mock("./platform-db", () => mocks);
vi.mock("./authz", () => ({
  requireRequestAuth: async () => ({
    authSource: "api-token",
    tokenId: "token",
    user: { id: "alice" },
    pathPrefix: "/safe",
    permissions: ["write"],
  }),
}));
vi.mock("./bindings", () => ({
  requireStringBindings: () => ({
    BETTER_AUTH_SECRET: "local-security-test-secret",
  }),
}));
import { idempotent } from "./idempotency";
const execute = vi.fn(async (request: Request) =>
  Response.json({ ok: true, input: await request.json() }),
);
function request(body: unknown, type: string) {
  return new Request("https://agfs.dev/api/v1/fs/upload-intents", {
    method: "POST",
    headers: { "content-type": type, "idempotency-key": "test-request-key" },
    body: JSON.stringify(body),
  });
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.first.mockResolvedValue({ key_hash: "reserved" });
  mocks.rows.mockResolvedValue([]);
});
it("rejects unsupported media types without reserving an idempotent request", async () => {
  await expect(
    idempotent(request({ path: "/safe/file" }, "text/plain"), execute),
  ).rejects.toMatchObject({ status: 415 });
  expect(mocks.first).not.toHaveBeenCalled();
  expect(execute).not.toHaveBeenCalled();
});
it("bounds mixed-case JSON bodies before creating any reservation", async () => {
  await expect(
    idempotent(
      request(
        { path: "/safe/file", padding: "x".repeat(20000) },
        "Application/JSON; charset=utf-8",
      ),
      execute,
    ),
  ).rejects.toMatchObject({ status: 413 });
  expect(mocks.first).not.toHaveBeenCalled();
  expect(execute).not.toHaveBeenCalled();
});
it("still executes valid bounded requests and encrypts their saved response", async () => {
  const response = await idempotent(
    request({ path: "/safe/file", size: 1 }, "Application/JSON"),
    execute,
  );
  expect(response.status).toBe(200);
  await expect(response.json()).resolves.toMatchObject({
    input: { path: "/safe/file", size: 1 },
  });
  expect(execute).toHaveBeenCalledTimes(1);
  expect(mocks.rows).toHaveBeenCalledTimes(1);
});

it.each([null, [], "invalid", { path: 42 }])(
  "rejects invalid request objects before reserving a key: %j",
  async (body) => {
    await expect(
      idempotent(request(body, "application/json"), execute),
    ).rejects.toMatchObject({ status: 400 });
    expect(mocks.first).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
  },
);
it("bounds unsupported payloads too", async () => {
  await expect(
    idempotent(
      request({ path: "/safe/file", padding: "x".repeat(20000) }, "text/plain"),
      execute,
    ),
  ).rejects.toMatchObject({ status: 413 });
  expect(mocks.first).not.toHaveBeenCalled();
  expect(execute).not.toHaveBeenCalled();
});
