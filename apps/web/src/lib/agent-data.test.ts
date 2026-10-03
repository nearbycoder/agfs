import { describe, expect, it } from "vitest";
import {
  compareLineSets,
  csvMarkdown,
  joinCsv,
  matchesPathGlob,
  projectCsv,
  testPathScope,
} from "./agent-data";
import { parseCsv } from "./csv-inspector";
describe("agent data preparation", () => {
  it("projects and reorders quoted columns, protecting formula output", () => {
    expect(
      parseCsv(
        projectCsv('id,name,formula\n1,"Ada, A",=1+1', ["name", "formula"]),
      ),
    ).toEqual([
      ["name", "formula"],
      ["Ada, A", "'=1+1"],
    ]);
  });
  it("rejects unknown, duplicated, and ragged projection columns", () => {
    expect(() => projectCsv("a,b\n1,2", ["c"])).toThrow("Unknown");
    expect(() => projectCsv("a,a\n1,2", ["a"])).toThrow("unique");
    expect(() => projectCsv("a,b\n1", ["a"])).toThrow("same number");
    expect(() => projectCsv("a,b\n1,2", ["a", "a"])).toThrow("distinct");
  });
  it("left joins unmatched rows and resolves all header collisions", () => {
    const result = joinCsv(
      "id,name,right.name\n1,A,Q\n2,B,R",
      "id,name\n1,Z",
      "id",
      "left",
    );
    expect(parseCsv(result)).toEqual([
      ["id", "name", "right.name", "right.right.name"],
      ["1", "A", "Q", "Z"],
      ["2", "B", "R", ""],
    ]);
  });
  it("inner joins omit unmatched rows and reject ambiguous keys", () => {
    expect(
      parseCsv(joinCsv("id,x\n1,a\n2,b", "id,y\n1,c", "id", "inner")),
    ).toHaveLength(2);
    expect(() => joinCsv("id\n1", "id\n1\n1", "id", "left")).toThrow("unique");
    expect(() => joinCsv("id\n1", 'id\n""', "id", "left")).toThrow("nonempty");
  });
  it("escapes Markdown table delimiters, multiline fields, and HTML", () => {
    expect(csvMarkdown('name,text\na,"x|y\n<script>"')).toContain(
      "x\\|y &lt;script&gt;",
    );
  });
  it("compares line sets with stable order and explicit normalization", () => {
    expect(compareLineSets("a\nb\na\n", "b\nc\n", "union", "exact")).toEqual([
      "a",
      "b",
      "c",
    ]);
    expect(compareLineSets("a\nb", "b\nc", "left-only", "exact")).toEqual([
      "a",
    ]);
    expect(compareLineSets("a\nb", "b\nc", "right-only", "exact")).toEqual([
      "c",
    ]);
    expect(compareLineSets(" a \nb", "a\nc", "intersection", "trim")).toEqual([
      "a",
    ]);
    expect(compareLineSets("", "", "union", "exact")).toEqual([]);
  });
  it.each([
    ["/outputs/a.json", "/outputs/**/*.json", true],
    ["/outputs/deep/a.json", "/outputs/**/*.json", true],
    ["/outputs/deep/a.json", "/outputs/*.json", false],
    ["/outputs/a.json", "/outputs/?.json", true],
    ["/outputs/ab.json", "/outputs/?.json", false],
    ["/outputs/a.json", "/output*/*.json", true],
    ["/outputs/a[1].json", "/outputs/a[1].json", true],
    ["/private/a.json", "/outputs/**", false],
    ["/outputs/deep/a.json", "/outputs/**/a.json", true],
  ])("matches %s against %s", (path, pattern, expected) =>
    expect(matchesPathGlob(path, pattern)).toBe(expected),
  );
  it("bounds scope matching work and requires absolute paths", () => {
    expect(() => testPathScope("relative", "/**")).toThrow("absolute");
    expect(() =>
      testPathScope(Array(501).fill("/x").join("\n"), "/**"),
    ).toThrow("500");
    expect(() =>
      testPathScope(
        Array(500)
          .fill("/" + "x".repeat(1000))
          .join("\n"),
        "/" + "*".repeat(200),
      ),
    ).toThrow("too large");
  });
});
