import { textBlob } from "./text-format";
export async function saveBrowserText(
  path: string,
  text: string,
  ifMatch: string | null,
  contentType = "text/plain",
) {
  const blob = textBlob(text, contentType);
  async function post(url: string, body: unknown) {
    const r = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const value = await r.json();
    if (!r.ok) throw new Error(value.error ?? "Save failed");
    return value;
  }
  const intent = await post("/api/v1/fs/upload-intents", {
    path,
    size: blob.size,
    contentType,
    ifMatch,
  });
  if (!/^[a-zA-Z0-9_-]+$/.test(intent.uploadId))
    throw new Error("Invalid upload response");
  const token = intent.headers?.["X-AGFS-Upload-Token"];
  if (typeof token !== "string" || !token)
    throw new Error("Missing upload authorization");
  const response = await fetch(
    "/api/v1/fs/uploads/" + intent.uploadId + "/blob",
    {
      method: "PUT",
      headers: { "content-type": contentType, "x-agfs-upload-token": token },
      body: blob,
    },
  );
  if (!response.ok)
    throw new Error("File upload failed. Your edits are still available.");
  const etag = response.headers.get("etag");
  if (!etag) throw new Error("Upload did not return a checksum");
  return post("/api/v1/fs/uploads/" + intent.uploadId + "/commit", { etag });
}
