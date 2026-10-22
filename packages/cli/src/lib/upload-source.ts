import type { FileHandle } from "node:fs/promises";

/** Each read owns its buffer; complete parts need no second full-sized allocation. */
export async function readUploadPart(file: Pick<FileHandle, "read">, start: number, end: number) {
  const buffer = new Uint8Array(end - start);
  const { bytesRead } = await file.read(buffer, 0, buffer.length, start);
  return bytesRead === buffer.length ? buffer.buffer : buffer.buffer.slice(0, bytesRead);
}
