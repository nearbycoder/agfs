import { expect, it, vi } from "vitest";
import worker from "./index";
import { signTicket } from "./ticket";

const secret = "preview-test-only-secret";
async function url(exp = Date.now() + 60000) {
  return `https://preview.agfs.dev/view?ticket=${await signTicket({ key: "owner/object", name: "文 file.txt", type: "text/plain", exp }, secret)}`;
}
it("#49 serves signed HEAD requests with metadata only and the same security headers as GET", async () => {
  const get = vi.fn(async () => ({ size: 7, body: new Response("content").body }));
  const head = vi.fn(async () => ({ size: 7 }));
  const env = { PREVIEW_SIGNING_SECRET: secret, FILES_BUCKET: { get, head } } as any;
  const target = await url();
  const response = await worker.fetch(new Request(target, { method: "HEAD" }), env);
  expect(head).toHaveBeenCalledExactlyOnceWith("owner/object"); expect(get).not.toHaveBeenCalled();
  expect(response.status).toBe(200); expect(await response.text()).toBe("");
  expect(response.headers.get("content-length")).toBe("7");
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(response.headers.get("content-security-policy")).toContain("sandbox;");
  const full = await worker.fetch(new Request(target), env);
  expect([...full.headers]).toEqual([...response.headers]); expect(await full.text()).toBe("content");
});
it("does no R2 work for expired or forged HEAD tickets", async () => {
  const head = vi.fn(), get = vi.fn(), env = { PREVIEW_SIGNING_SECRET: secret, FILES_BUCKET: { get, head } } as any;
  expect((await worker.fetch(new Request(await url(Date.now() - 1000), { method: "HEAD" }), env)).status).toBe(403);
  expect((await worker.fetch(new Request("https://preview.agfs.dev/view?ticket=forged", { method: "HEAD" }), env)).status).toBe(403);
  expect(head).not.toHaveBeenCalled(); expect(get).not.toHaveBeenCalled();
});
it("returns a metadata-only 404 when the signed object's contents were removed", async () => {
  const head = vi.fn(async () => null), get = vi.fn();
  const response = await worker.fetch(new Request(await url(), { method: "HEAD" }), { PREVIEW_SIGNING_SECRET: secret, FILES_BUCKET: { head, get } } as any);
  expect(response.status).toBe(404); expect(get).not.toHaveBeenCalled();
});
