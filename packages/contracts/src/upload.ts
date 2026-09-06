/** Shared browser/CLI transfer loop. Re-read and hash every part before trusting a resumable part. */
export async function uploadResumable(input: {
  path: string;
  contentType: string;
  size: number;
  fingerprint: string;
  request: (path: string, init?: RequestInit) => Promise<Response>;
  read: (start: number, end: number) => Promise<ArrayBuffer>;
  progress?: (bytes: number) => void;
}) {
  const json = async (path: string, body: unknown) => {
    const response = await input.request(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const value = await response.json();
    if (!response.ok) throw new Error(value.error ?? "Upload failed");
    return value;
  };
  const state = (await json("/api/v1/fs/resumable", {
    path: input.path,
    contentType: input.contentType,
    size: input.size,
    fingerprint: input.fingerprint,
  })) as { uploadId: string; partSize: number; status: string; parts: { partNumber: number; digest: string }[] };
  if (state.partSize !== 8 * 1024 * 1024 || !/^[a-zA-Z0-9_-]+$/.test(state.uploadId))
    throw new Error("Invalid upload response");
  if (state.status !== "completing") {
    for (let start = 0, partNumber = 1; start < input.size; start += state.partSize, partNumber++) {
      const end = Math.min(input.size, start + state.partSize);
      const bytes = await input.read(start, end);
      if (bytes.byteLength !== end - start) throw new Error("Local file changed during upload");
      const digest = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
      if (state.parts.find((p) => p.partNumber === partNumber)?.digest !== digest) {
        for (let attempt = 0; ; attempt++) {
          try {
            const response = await input.request(`/api/v1/fs/resumable/${state.uploadId}/parts/${partNumber}`, {
              method: "PUT",
              headers: { "content-length": String(bytes.byteLength) },
              body: bytes,
            });
            if (!response.ok) throw new Error((await response.json()).error ?? "Part upload failed");
            break;
          } catch (error) {
            if (attempt >= 2) throw error;
            await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
          }
        }
      }
      input.progress?.(end);
    }
  }
  return json(`/api/v1/fs/resumable/${state.uploadId}/complete`, {});
}
