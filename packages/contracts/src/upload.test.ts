import { it, expect } from "vitest";
import { uploadResumable } from "./upload";
const bytes = new TextEncoder().encode("hello");
it("rehashes resumed parts and skips only matching bytes", async () => {
  const hash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  for (const digest of [hash, "mismatched"]) {
    const calls: string[] = [];
    await uploadResumable({
      path: "/file",
      contentType: "text/plain",
      size: 5,
      fingerprint: "test",
      read: async () => bytes.buffer,
      request: async (path) => {
        calls.push(path);
        return Response.json(
          path.endsWith("resumable")
            ? { uploadId: "upl_test", partSize: 8 * 1024 * 1024, status: "pending", parts: [{ partNumber: 1, digest }] }
            : { ok: true },
        );
      },
    });
    expect(calls.some((path) => path.endsWith("parts/1"))).toBe(digest !== hash);
    expect(calls.at(-1)).toContain("complete");
  }
});
it("does not complete if the local file changes length", async () => {
  await expect(
    uploadResumable({
      path: "/file",
      contentType: "text/plain",
      size: 6,
      fingerprint: "test",
      read: async () => bytes.buffer,
      request: async () =>
        Response.json({ uploadId: "upl_test", partSize: 8 * 1024 * 1024, status: "pending", parts: [] }),
    }),
  ).rejects.toThrow("Local file changed");
});
