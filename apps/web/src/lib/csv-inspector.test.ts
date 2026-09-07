import { describe, it, expect } from "vitest";
import { parseCsv } from "./csv-inspector";
describe("CSV inspector", () => {
  it("handles quoted delimiters, escaped quotes and embedded newlines", () =>
    expect(parseCsv('name,note\r\n"a,b","say ""yes""\nnext"\r\n')).toEqual([
      ["name", "note"],
      ["a,b", 'say "yes"\nnext'],
    ]));
  it("preserves empty cells and accepts BOM and alternative delimiters", () => {
    expect(parseCsv("\ufeffa;b;", ";")).toEqual([["a", "b", ""]]);
    expect(parseCsv("")).toEqual([]);
  });
  it("rejects malformed quotes", () => {
    for (const s of ['"a', 'a"b', '"a"x']) expect(() => parseCsv(s)).toThrow();
  });
  it("bounds table dimensions", () => {
    expect(() => parseCsv(",".repeat(200))).toThrow();
    expect(() => parseCsv("a\n".repeat(5001))).toThrow();
  });
});
