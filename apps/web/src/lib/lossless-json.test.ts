import { describe, it, expect } from "vitest";
import {
  parseExactJson,
  stringifyExactJson,
  JsonNumber,
} from "./lossless-json";
describe("Exact JSON", () => {
  it("preserves large and exponent numeric tokens, escapes, and prototype keys", () => {
    const source =
      '{"n":9007199254740993,"e":1e999,"__proto__":"safe","a":[true,null,"a\\\"b"]}';
    expect(stringifyExactJson(parseExactJson(source))).toBe(source);
    expect(parseExactJson("-0")).toBeInstanceOf(JsonNumber);
  });
  it("rejects duplicate keys, invalid syntax and excessive depth", () => {
    for (const s of [
      '{"x":1,"x":2}',
      "[1,]",
      "[".repeat(42) + "0" + "]".repeat(42),
    ])
      expect(() => parseExactJson(s)).toThrow();
  });
  it("enforces value and source bounds", () => {
    expect(() =>
      parseExactJson("[" + Array(10001).fill("0").join(",") + "]"),
    ).toThrow();
    expect(() => parseExactJson(JSON.stringify("x".repeat(262145)))).toThrow();
  });
});
