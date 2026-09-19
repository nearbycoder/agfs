import { expect, it, vi } from "vitest";
import { readUploadPart } from "./upload-body";
function request(chunks: Uint8Array[], declared: number) {
  const cancel = vi.fn();
  let reads = 0;
  const body = new ReadableStream(
    {
      pull(controller) {
        const chunk = chunks[reads++];
        if (chunk) controller.enqueue(chunk);
        else controller.close();
      },
      cancel,
    },
    { highWaterMark: 0 },
  );
  return {
    request: new Request("https://agfs.test/upload", {
      method: "PUT",
      headers: { "content-length": String(declared) },
      body,
      duplex: "half",
    } as RequestInit),
    cancel,
    reads: () => reads,
  };
}
it("preserves an exact upload across chunks", async () => {
  const input = request([new Uint8Array([1, 2]), new Uint8Array([3, 4, 5])], 5);
  expect(await readUploadPart(input.request, 5)).toEqual(
    new Uint8Array([1, 2, 3, 4, 5]).buffer,
  );
  expect(input.cancel).not.toHaveBeenCalled();
});
it("rejects a short body even when the header claims the exact size", async () => {
  const input = request([new Uint8Array(3)], 5);
  await expect(readUploadPart(input.request, 5)).rejects.toMatchObject({
    status: 400,
  });
});
it("stops a body exceeding its declared size without reading the remainder", async () => {
  const input = request(
    Array.from({ length: 100 }, () => new Uint8Array(4)),
    5,
  );
  await expect(readUploadPart(input.request, 5)).rejects.toMatchObject({
    status: 413,
  });
  expect(input.reads()).toBe(2);
  expect(input.cancel).toHaveBeenCalledOnce();
  expect(input.request.body?.locked).toBe(false);
});
it("rejects missing upload bytes", async () => {
  await expect(
    readUploadPart(new Request("https://agfs.test/upload"), 1),
  ).rejects.toMatchObject({ status: 400 });
});
