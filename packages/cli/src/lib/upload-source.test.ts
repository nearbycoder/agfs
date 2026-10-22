import { expect, it } from "vitest";
import { readUploadPart } from "./upload-source";
it("returns the exact owned full-part buffer without copying and preserves short reads", async () => {
  let allocated: Uint8Array;
  const file = { read: async (bytes: Uint8Array) => { allocated = bytes; bytes.fill(42); return { bytesRead: bytes.length }; } };
  const result = await readUploadPart(file as any, 0, 8388608);
  expect(result).toBe(allocated!.buffer);
  const short = { read: async (bytes: Uint8Array) => { bytes.fill(7); return { bytesRead: 3 }; } };
  expect(new Uint8Array(await readUploadPart(short as any, 0, 10))).toEqual(new Uint8Array([7, 7, 7]));
});
