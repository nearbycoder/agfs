import { describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ put: vi.fn(), get: vi.fn() }));
vi.mock("./bindings", () => ({
  requireResourceBindings: () => ({ FILES_BUCKET: mocks }),
  requireStringBindings: () => ({ APP_URL: "https://agfs.dev" }),
}));
import { createUploadIntentUrl, putObject, streamObject } from "./r2";

it("uses a Worker capability and conditional create-only R2 writes", async () => {
  const intent = await createUploadIntentUrl({ uploadId: "u", uploadToken: "secret", objectKey: "key", contentType: "text/html", expiresAt: new Date() });
  expect(intent.url).toBe("https://agfs.dev/api/v1/fs/uploads/u/blob");
  expect(intent.headers["X-AGFS-Upload-Token"]).toBe("secret");
  await putObject("key", new ArrayBuffer(0), "text/html");
  expect(mocks.put).toHaveBeenCalledWith("key", expect.any(ArrayBuffer), expect.objectContaining({ onlyIf: { etagDoesNotMatch: "*" } }));
});
it("isolates active content and prevents cached access after revocation", async () => {
  mocks.get.mockResolvedValue({ body: "<script>alert(1)</script>", httpMetadata: { contentType: "text/html" } });
  const response = await streamObject("key");
  expect(response.headers.get("content-security-policy")).toContain("sandbox;");
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(response.headers.get("x-content-type-options")).toBe("nosniff");
});
