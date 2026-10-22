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

it("rejects invalid retry budgets and normalized paths outside the API", async () => {
  for (const retries of [NaN, Infinity, -1, 1.5, 6])
    expect(() => new AgfsClient({ token: "secret", retries })).toThrow("Retries");
  const transport = vi.fn();
  const client = new AgfsClient({ token: "secret", fetch: transport });
  for (const path of ["/api/v1/../../admin", "/api/v1/%2e%2e/other", "/api/v1/whoami#fragment", "/api/v1/..\\..\\admin"])
    await expect(client.request(path)).rejects.toThrow("Invalid AGFS API path");
  expect(transport).not.toHaveBeenCalled();
});

it("never retries a consumed streaming request body", async () => {
  const transport = vi.fn(async () => Response.json({ error: "busy" }, { status: 503 }));
  const client = new AgfsClient({ token: "secret", fetch: transport });
  await expect(client.request("/api/v1/test", { method: "PUT", body: new Response("data").body })).rejects.toThrow("busy");
  expect(transport).toHaveBeenCalledTimes(1);
});

it.each([
  ["https://www.agfs.dev", "https://agfs.dev"],
  ["http://127.0.0.1:8787", "http://localhost:8787"],
  ["https://agfs.dev", "https://evil.example"],
])("keeps empty-upload capabilities on %s when the API advertises %s", async (baseUrl, advertised) => {
  const transport = vi.fn(async (url, init) => {
    expect(new URL(url).origin).toBe(baseUrl);
    expect(init.redirect).toBe("error");
    if (url.endsWith("/upload-intents")) return Response.json({
      uploadId: "upl_test", url: `${advertised}/api/v1/fs/uploads/upl_test/blob`,
      headers: { "X-AGFS-Upload-Token": "fixture-capability" },
    });
    if (url.endsWith("/blob")) {
      expect(new Headers(init.headers).get("authorization")).toBeNull();
      expect(new Headers(init.headers).get("X-AGFS-Upload-Token")).toBe("fixture-capability");
      expect(await new Response(init.body).text()).toBe("");
      return new Response(null, { headers: { etag: "empty" } });
    }
    expect(url).toBe(`${baseUrl}/api/v1/fs/uploads/upl_test/commit`);
    return Response.json({ entry: { path: "/empty" } });
  });
  await expect(new AgfsClient({ token: "secret", baseUrl, fetch: transport }).upload("/empty", new Uint8Array()))
    .resolves.toEqual({ path: "/empty" });
  expect(transport).toHaveBeenCalledTimes(3);
});

it.each(["https://agfs.dev/api/v1/fs/uploads/upl_other/blob", "https://user:pass@agfs.dev/api/v1/fs/uploads/upl_test/blob", "https://agfs.dev/api/v1/fs/uploads/upl_test/blob?token=x"])("rejects malformed upload capabilities: %s", async (url) => {
  const transport = vi.fn(async () => Response.json({ uploadId: "upl_test", url, headers: {} }));
  await expect(new AgfsClient({ token: "secret", fetch: transport }).upload("/empty", new Uint8Array()))
    .rejects.toThrow("Unexpected upload capability");
  expect(transport).toHaveBeenCalledTimes(1);
});
