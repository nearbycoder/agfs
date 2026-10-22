import { beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ get: vi.fn(), head: vi.fn() }));
vi.mock("./bindings", () => ({ requireResourceBindings: () => ({ FILES_BUCKET: state }) }));
import { streamObject } from "./r2";

const bytes = new TextEncoder().encode("0123456789");
beforeEach(() => {
  state.head.mockReset().mockResolvedValue({ size: 10, etag: "revision" });
  state.get.mockReset().mockImplementation(async (_key, options) => ({
    size: 10, etag: "revision", httpMetadata: { contentType: "text/plain" },
    body: new Response(options?.range ? bytes.slice(options.range.offset, options.range.offset + options.range.length) : bytes).body,
  }));
});
const request = (range?: string, ifRange?: string) => new Request("https://agfs.dev/api/v1/fs/download?path=/file", {
  headers: { ...(range === undefined ? {} : { range }), ...(ifRange === undefined ? {} : { "if-range": ifRange }) },
});
it.each([
  ["bytes=2-4", "234", "bytes 2-4/10", 2, 3],
  ["bytes=7-", "789", "bytes 7-9/10", 7, 3],
  ["bytes=-3", "789", "bytes 7-9/10", 7, 3],
  ["bytes=7-999999999999999999999999", "789", "bytes 7-9/10", 7, 3],
  ["bytes=-999999999999999999999999", "0123456789", "bytes 0-9/10", 0, 10],
  ["bytes=0-0", "0", "bytes 0-0/10", 0, 1],
])("#50 streams %s with only its selected bytes", async (range, text, contentRange, offset, length) => {
  const response = await streamObject("key", { headers: { "content-disposition": "attachment" } }, request(String(range)));
  expect(response.status).toBe(206); expect(await response.text()).toBe(text);
  expect(response.headers.get("content-range")).toBe(contentRange);
  expect(response.headers.get("content-length")).toBe(String(length));
  expect(response.headers.get("content-disposition")).toBe("attachment");
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(response.headers.get("content-security-policy")).toContain("sandbox;");
  expect(response.headers.get("accept-ranges")).toBe("bytes");
  expect(state.get).toHaveBeenCalledExactlyOnceWith("key", { range: { offset, length }, onlyIf: { etagMatches: "revision" } });
});
it.each(["bytes=10-", "bytes=-0", "bytes=4-2", "bytes=999999999999999999999999-"])("rejects unsatisfiable %s without requesting a body", async (range) => {
  const response = await streamObject("key", undefined, request(range));
  expect(response.status).toBe(416); expect(response.headers.get("content-range")).toBe("bytes */10");
  expect(await response.text()).toBe(""); expect(state.get).not.toHaveBeenCalled();
});
it.each([undefined, "bytes=-", "items=0-1", "bytes=0-1,4-5", "bytes=1.5-2", "bytes=nonsense"])("ignores unsupported %s without an extra metadata read", async (range) => {
  const response = await streamObject("key", undefined, request(range));
  expect(response.status).toBe(200); expect(await response.text()).toBe("0123456789");
  expect(state.head).not.toHaveBeenCalled(); expect(state.get).toHaveBeenCalledExactlyOnceWith("key");
});
it.each(['"other"', 'W/"revision"', "Wed, 21 Oct 2026 00:00:00 GMT"])("sends the whole representation for an unmatched/unsupported If-Range %s", async (validator) => {
  const response = await streamObject("key", undefined, request("bytes=0-1", validator));
  expect(response.status).toBe(200); expect(await response.text()).toBe("0123456789");
  expect(state.get).toHaveBeenCalledExactlyOnceWith("key");
});
it("honors a matching strong If-Range and rejects a changed object between HEAD and GET", async () => {
  expect((await streamObject("key", undefined, request("bytes=0-1", '"revision"'))).status).toBe(206);
  state.get.mockResolvedValueOnce({ size: 10, etag: "changed" });
  expect((await streamObject("key", undefined, request("bytes=0-1"))).status).toBe(412);
});
it("handles empty and missing objects without fetching their body", async () => {
  state.head.mockResolvedValueOnce({ size: 0, etag: "empty" }).mockResolvedValueOnce(null);
  const empty = await streamObject("empty", undefined, request("bytes=0-0"));
  expect(empty.status).toBe(416); expect(empty.headers.get("content-range")).toBe("bytes */0");
  expect((await streamObject("missing", undefined, request("bytes=0-0"))).status).toBe(404);
  expect(state.get).not.toHaveBeenCalled();
});
it("propagates consumer cancellation to the R2 stream", async () => {
  const cancel = vi.fn();
  state.get.mockResolvedValueOnce({ size: 10, etag: "revision", body: new ReadableStream({ cancel }) });
  const response = await streamObject("key", undefined, request("bytes=0-1"));
  await response.body!.cancel("left page"); expect(cancel).toHaveBeenCalledExactlyOnceWith("left page");
});
