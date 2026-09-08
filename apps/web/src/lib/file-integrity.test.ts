import { describe, it, expect } from "vitest";
import { sha256, compareDigest } from "./file-integrity";
describe("Local SHA-256", () => {
  it("matches the standard abc digest", async () => {
    expect(await sha256(new TextEncoder().encode("abc").buffer)).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });
  it("compares case-insensitively while validating expected values", () => {
    expect(compareDigest("a".repeat(64), " A".trim().repeat(64))).toBe(true);
    expect(compareDigest("a".repeat(64), "b".repeat(64))).toBe(false);
    expect(() => compareDigest("a".repeat(64), "short")).toThrow();
  });
});
