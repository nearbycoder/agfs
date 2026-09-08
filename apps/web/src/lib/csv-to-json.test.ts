import { describe, it, expect } from "vitest";
import { csvToJson } from "./csv-to-json";
describe("CSV to JSON", () => {
  it("preserves strings including long numbers and prototype keys", () => {
    const result = JSON.parse(
      csvToJson([
        ["__proto__", "n"],
        ["safe", "9007199254740993"],
      ]).text,
    );
    expect(result[0].__proto__).toBe("safe");
    expect(result[0].n).toBe("9007199254740993");
  });
  it("rejects ambiguous headers and ragged records", () => {
    for (const rows of [[["x", " x "]], [["", "y"]], [["a", "b"], ["1"]]])
      expect(() => csvToJson(rows)).toThrow();
  });
  it("bounds repeated headers and allows header-only CSV", () => {
    expect(JSON.parse(csvToJson([["a"]]).text)).toEqual([]);
    expect(() =>
      csvToJson([
        ["h".repeat(1000)],
        ...Array.from({ length: 2000 }, () => ["x"]),
      ]),
    ).toThrow();
  });
});
