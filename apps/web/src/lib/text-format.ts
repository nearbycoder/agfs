export const MAX_TEXT_BYTES = 256 * 1024;
export function decodeEditableText(bytes: ArrayBuffer): string {
  if (bytes.byteLength > MAX_TEXT_BYTES)
    throw new Error(
      "Text tools support files up to 256 KiB. Download this file instead.",
    );
  const value = new TextDecoder("utf-8", {
    fatal: true,
    ignoreBOM: true,
  }).decode(bytes);
  if (value.includes("\0"))
    throw new Error("Binary files cannot be opened as text.");
  return value;
}
export function textBlob(text: string, contentType = "text/plain") {
  if (text.includes("\0"))
    throw new Error("Text cannot contain NUL characters.");
  const blob = new Blob([text], { type: contentType });
  if (blob.size > MAX_TEXT_BYTES)
    throw new Error("Text tools support files up to 256 KiB.");
  return blob;
}
