import { expect, it, vi } from "vitest";
import { AgfsClient, AgfsError } from "./index";
it("rejects URLs that could leak credentials and forbids redirects", async () => {
  expect(
    () =>
      new AgfsClient({
        token: "secret",
        baseUrl: "https://user:pass@agfs.dev",
      }),
  ).toThrow();
  expect(
    () => new AgfsClient({ token: "secret", baseUrl: "http://example.com" }),
  ).toThrow();
  const transport = vi.fn(async (_url, init) => {
    expect(init.redirect).toBe("error");
    expect(init.headers.get("authorization")).toBe("Bearer secret");
    return Response.json({});
  });
  const client = new AgfsClient({ token: "secret", fetch: transport });
  await expect(client.request("//evil.com/api/v1")).rejects.toThrow();
  await client.whoami();
  expect(transport).toHaveBeenCalledTimes(1);
});
it("paginates search and forwards conditional writes", async () => {
  const transport = vi.fn(async (url, init) => {
    if (String(url).includes("search"))
      return Response.json(
        String(url).includes("cursor=second")
          ? { results: [{ path: "/b" }], nextCursor: null }
          : { results: [{ path: "/a" }], nextCursor: "second" },
      );
    const body = JSON.parse(init.body);
    expect(body.ifMatch).toBe(null);
    return Response.json({ error: "conflict" }, { status: 409 });
  });
  const client = new AgfsClient({ token: "secret", fetch: transport });
  const paths = [];
  for await (const item of client.searchAll()) paths.push(item.path);
  expect(paths).toEqual(["/a", "/b"]);
  await expect(
    client.upload("/new", new Uint8Array(), { ifMatch: null }),
  ).rejects.toBeInstanceOf(AgfsError);
  expect(transport).toHaveBeenCalledTimes(3);
});
it("never retries non-idempotent POST requests", async () => {
  const transport = vi.fn(async () =>
    Response.json({ error: "busy" }, { status: 503 }),
  );
  const client = new AgfsClient({ token: "secret", fetch: transport });
  await expect(client.mkdir("/folder")).rejects.toThrow("busy");
  expect(transport).toHaveBeenCalledTimes(1);
});
