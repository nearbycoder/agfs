import { createHash } from "node:crypto";
import { expect, it, vi } from "vitest";
import { AgfsClient } from "./index";

const partSize = 8 * 1024 * 1024;
const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

it("overlaps bounded parts, reads the fingerprint chunk once, and reports monotonic acknowledged progress", async () => {
  const size = 3 * partSize + 10;
  const read = vi.fn(async (start: number, end: number) => new Uint8Array(end - start).fill(start / partSize));
  const pending = new Map<number, () => void>();
  const progress: number[] = [];
  let completed = false;
  const transport = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const route = String(url);
    if (route.endsWith("/resumable")) return Response.json({ uploadId: "upl_test", partSize, status: "pending", parts: [] });
    if (route.endsWith("/complete")) {
      completed = true;
      expect(pending.size).toBe(0);
      return Response.json({ entry: { path: "/file" } });
    }
    const part = Number(route.split("/").at(-1));
    expect((init!.body as Uint8Array)[0]).toBe(part - 1);
    await new Promise<void>((resolve) => pending.set(part, resolve));
    pending.delete(part);
    return Response.json({ ok: true });
  });
  const client = new AgfsClient({ token: "fixture", fetch: transport });
  const uploading = client.uploadSource("/file", { size, read }, { concurrency: 2, onProgress: (n) => progress.push(n) });
  await vi.waitFor(() => expect([...pending.keys()]).toEqual([1, 2]));
  expect(completed).toBe(false);
  pending.get(2)!();
  await vi.waitFor(() => expect([...pending.keys()]).toEqual([1, 3]));
  pending.get(3)!();
  await vi.waitFor(() => expect([...pending.keys()]).toEqual([1, 4]));
  pending.get(4)!();
  await vi.waitFor(() => expect([...pending.keys()]).toEqual([1]));
  expect(completed).toBe(false);
  pending.get(1)!();
  await uploading;
  expect(read.mock.calls.map(([start]) => start)).toEqual([0, partSize, 2 * partSize, 3 * partSize]);
  expect(progress).toEqual([partSize, 2 * partSize, 2 * partSize + 10, size]);
});

it("rehashes resumed bytes and sends only changed parts", async () => {
  const read = vi.fn(async (start: number, end: number) => new Uint8Array(end - start).fill(7));
  const uploaded: number[] = [];
  const client = new AgfsClient({ token: "fixture", fetch: async (url) => {
    if (String(url).endsWith("/resumable")) return Response.json({
      uploadId: "upl_test", partSize, status: "pending",
      parts: [{ partNumber: 1, digest: sha(new Uint8Array(partSize).fill(7)) }, { partNumber: 2, digest: "0".repeat(64) }],
    });
    if (String(url).includes("/parts/")) uploaded.push(Number(String(url).split("/").at(-1)));
    return Response.json({ entry: {} });
  }});
  await client.uploadSource("/file", { size: partSize + 10, read });
  expect(uploaded).toEqual([2]);
  expect(read).toHaveBeenCalledTimes(2);
});

it("waits for active parts after failure and never commits or schedules more parts", async () => {
  const pending = new Map<number, (value: Response) => void>();
  const routes: string[] = [];
  const client = new AgfsClient({ token: "fixture", retries: 0, fetch: async (url) => {
    const route = String(url);
    routes.push(route);
    if (route.endsWith("/resumable")) return Response.json({ uploadId: "upl_test", partSize, status: "pending", parts: [] });
    return new Promise<Response>((resolve) => pending.set(Number(route.split("/").at(-1)), resolve));
  }});
  let settled = false;
  const uploading = client.uploadSource("/file", {
    size: partSize * 4, read: async (start, end) => new Uint8Array(end - start),
  }, { concurrency: 2 });
  const outcome = uploading.then(() => { settled = true; return null; }, (error: Error) => { settled = true; return error; });
  await vi.waitFor(() => expect(pending.size).toBe(2));
  pending.get(1)!(Response.json({ error: "failed part" }, { status: 400 }));
  await new Promise((resolve) => setTimeout(resolve, 10));
  expect(settled).toBe(false);
  pending.get(2)!(Response.json({ ok: true }));
  expect((await outcome)?.message).toBe("failed part");
  expect(routes.some((route) => /parts\/[34]$|\/complete$/.test(route))).toBe(false);
});

it("rejects invalid limits, short fingerprint reads, and pre-cancelled uploads before network calls", async () => {
  const transport = vi.fn();
  const client = new AgfsClient({ token: "fixture", fetch: transport });
  for (const concurrency of [0, 9, NaN, 1.5])
    await expect(client.upload("/file", new Blob(["x"]), { concurrency })).rejects.toThrow("Concurrency");
  await expect(client.uploadSource("/file", { size: 4, read: async () => new Uint8Array(2) })).rejects.toThrow("Local file changed");
  const cancelled = new AgfsClient({ token: "fixture", fetch: transport, signal: AbortSignal.abort() });
  const read = vi.fn();
  await expect(cancelled.uploadSource("/file", { size: 4, read })).rejects.toThrow();
  expect(read).not.toHaveBeenCalled();
  expect(transport).not.toHaveBeenCalled();
});

it("rejects duplicate resume records instead of trusting ambiguous state", async () => {
  const record = { partNumber: 1, digest: "0".repeat(64) };
  const transport = vi.fn(async () => Response.json({ uploadId: "upl_test", partSize, status: "pending", parts: [record, record] }));
  const client = new AgfsClient({ token: "fixture", fetch: transport });
  await expect(client.uploadSource("/file", { size: partSize + 1, read: async (start, end) => new Uint8Array(end - start) })).rejects.toThrow("Invalid upload response");
  expect(transport).toHaveBeenCalledTimes(1);
});
