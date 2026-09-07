import { describe, it, expect } from "vitest";
import { decodeEditableText, textBlob, MAX_TEXT_BYTES } from "./text-format";
describe("bounded UTF-8 tools", () => {
  it("preserves Unicode and the byte order mark", () => {
    const bytes = new TextEncoder().encode("\ufeffHello 🌍");
    expect(decodeEditableText(bytes.buffer)).toBe("\ufeffHello 🌍");
  });
  it("rejects binary and invalid UTF-8", () => {
    expect(() => decodeEditableText(new Uint8Array([0]).buffer)).toThrow();
    expect(() => decodeEditableText(new Uint8Array([0xff]).buffer)).toThrow();
  });
  it("bounds bytes rather than characters and permits empty files", () => {
    expect(textBlob("").size).toBe(0);
    expect(() => textBlob("🌍".repeat(MAX_TEXT_BYTES / 2))).toThrow();
    expect(() =>
      decodeEditableText(new Uint8Array(MAX_TEXT_BYTES + 1).buffer),
    ).toThrow();
  });
});
