import { describe, it, expect } from "vitest";
import { convertEncoding } from "./encoding-workbench";
describe("Encoding conversion", () => {
  it("round-trips Unicode and preserves BOM", () => {
    const text = "\ufeffHello 🌍";
    const b64 = convertEncoding(text, "utf8", "base64").output;
    expect(convertEncoding(b64, "base64", "utf8").output).toBe(text);
    expect(convertEncoding("61 62 63", "hex", "utf8").output).toBe("abc");
  });
  it("rejects invalid UTF-8, hex, padding and noncanonical Base64", () => {
    for (const [value, from] of [
      ["ff", "hex"],
      ["0", "hex"],
      ["Zg=", "base64"],
      ["Zh==", "base64"],
    ] as const)
      expect(() => convertEncoding(value, from, "utf8")).toThrow();
  });
  it("supports binary conversions without decoding text and bounds input", () => {
    expect(convertEncoding("/w==", "base64", "hex").output).toBe("ff");
    expect(() => convertEncoding("x".repeat(262145), "utf8", "hex")).toThrow();
    expect(() => convertEncoding("\ud800", "utf8", "hex")).toThrow();
  });
});
