import { describe, it, expect } from "vitest";
import { exportCsv } from "./csv-download";
import { parseCsv } from "./csv-inspector";
describe("CSV downloads", () => {
  it("round-trips delimiters, multiline cells and uneven rows", () => {
    const rows = [["x;y", 'a"b'], ["one\ntwo"]];
    expect(parseCsv(exportCsv(rows, ";"), ";")).toEqual(rows);
  });
  it("protects formulas including whitespace prefixes", () => {
    expect(parseCsv(exportCsv([[" =1", "-2", "@SUM(A1)", "safe"]]))[0]).toEqual(
      ["' =1", "'-2", "'@SUM(A1)", "safe"],
    );
  });
  it("bounds expansion and rejects invalid separators", () => {
    expect(() => exportCsv([["x".repeat(1048576)]])).toThrow();
    expect(() => exportCsv([], "|")).toThrow();
  });
});
