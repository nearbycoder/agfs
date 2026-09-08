import { describe, it, expect } from "vitest";
import { parseExactJson } from "./lossless-json";
import { jsonToCsv } from "./json-to-csv";
import { parseCsv } from "./csv-inspector";
describe("JSON to CSV", () => {
  it("unions columns and preserves numbers, null and nested values", () => {
    const r = jsonToCsv(
      parseExactJson('[{"id":9007199254740993,"x":null},{"nested":{"a":1}}]'),
    );
    expect(parseCsv(r.text)).toEqual([
      ["id", "x", "nested"],
      ["9007199254740993", "null", ""],
      ["", "", '{"a":1}'],
    ]);
  });
  it("protects formula headers and values", () => {
    expect(
      parseCsv(jsonToCsv(parseExactJson('[{"=key":"+formula"}]')).text),
    ).toEqual([["'=key"], ["'+formula"]]);
  });
  it("rejects nonrecords and empty schemas", () => {
    for (const s of ["{}", "[1]", "[]", "[{}]"])
      expect(() => jsonToCsv(parseExactJson(s))).toThrow();
  });
});
