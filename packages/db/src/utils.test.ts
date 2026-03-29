import { describe, expect, it } from "vitest";
import { buildObjectKey, normalizeAgfsPath, parseTtl, verifyHash, hashSecret } from "./utils";

describe("normalizeAgfsPath", () => {
  it("normalizes slashes and roots paths", () => {
    expect(normalizeAgfsPath("screenshots///shot.png")).toBe("/screenshots/shot.png");
    expect(normalizeAgfsPath("/")).toBe("/");
  });

  it("rejects relative segments", () => {
    expect(() => normalizeAgfsPath("../secret.txt")).toThrow(/Relative path segments/);
  });

  it("rejects control characters and backslashes", () => {
    expect(() => normalizeAgfsPath("/notes/..\u0000.txt")).toThrow(/unsupported characters/i);
    expect(() => normalizeAgfsPath("/notes\\archive/report.txt")).toThrow(/unsupported characters/i);
  });
});

describe("parseTtl", () => {
  it("supports minutes, hours, and days", () => {
    expect(parseTtl("15m")).toBe(900000);
    expect(parseTtl("1h")).toBe(3600000);
    expect(parseTtl("2d")).toBe(172800000);
  });
});

describe("crypto helpers", () => {
  it("builds stable object keys and verifies hashes", () => {
    expect(buildObjectKey("user_1", "ent_1", "ver_1")).toBe("u/user_1/f/ent_1/ver_1");
    expect(verifyHash("agfs_token", hashSecret("agfs_token"))).toBe(true);
  });
});
