import { describe, it, expect } from "vitest";
import { parseExactJson } from "./lossless-json";
import { resolvePointer } from "./json-pointer";
describe("JSON Pointer", () => {
  const root = parseExactJson(
    '{"a/b":{"~key":[null,9]},"":true,"__proto__":"own"}',
  );
  it("resolves escaped keys, empty keys, arrays and root", () => {
    expect(resolvePointer(root, "/a~1b/~0key/0")).toEqual({
      found: true,
      value: null,
    });
    expect(resolvePointer(root, "/")).toEqual({ found: true, value: true });
    expect(resolvePointer(root, "").found).toBe(true);
    expect(resolvePointer(root, "/__proto__")).toEqual({
      found: true,
      value: "own",
    });
  });
  it("distinguishes missing values and disallows inherited/index aliases", () => {
    for (const p of [
      "/missing",
      "/a~1b/~0key/01",
      "/a~1b/~0key/-",
      "/constructor",
    ])
      expect(resolvePointer(root, p)).toEqual({ found: false });
  });
  it("rejects invalid syntax", () => {
    expect(() => resolvePointer(root, "a")).toThrow();
    expect(() => resolvePointer(root, "/~2")).toThrow();
  });
});
