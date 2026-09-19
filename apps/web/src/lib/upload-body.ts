import { errorResponse } from "./http";

/** Bound actual bytes as well as the declared length before hashing or R2 writes. */
export async function readUploadPart(
  request: Request,
  expected: number,
): Promise<ArrayBuffer> {
  const reader = request.body?.getReader();
  if (!reader) throw errorResponse(400, "Invalid part size");
  const bytes = new Uint8Array(expected);
  let offset = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value.byteLength > expected - offset) {
        await reader.cancel();
        throw errorResponse(413, "Upload part too large");
      }
      bytes.set(value, offset);
      offset += value.byteLength;
    }
  } finally {
    reader.releaseLock();
  }
  if (offset !== expected) throw errorResponse(400, "Invalid part size");
  return bytes.buffer;
}
