import { describe, it, expect } from "vitest";
import { inspectJson } from "./json-inspector";
describe("JSON inspection", () => {
  it("preserves exact numbers and duplicate keys when formatting", () => {
    const d = inspectJson('{"n":9007199254740993,"n":1e400}');
    expect(d.formatted).toContain("9007199254740993");
    expect(d.formatted).toContain("1e400");
  });
  it("uses escaped JSON pointers and treats hostile keys as data", () => {
    const r = inspectJson('{"a/b":{"~":"<script>"},"__proto__":true}');
    expect(r.nodes.map((n) => n.path)).toEqual([
      "",
      "/a~1b",
      "/a~1b/~0",
      "/__proto__",
    ]);
    expect(r.nodes[2].value).toBe('"<script>"');
  });
  it("handles scalar roots and reports syntax errors", () => {
    expect(inspectJson("null").nodes[0].value).toBe("null");
    expect(() => inspectJson("{")).toThrow("Invalid JSON");
  });
  it("bounds recursion and node count", () => {
    expect(() => inspectJson("[".repeat(42) + "0" + "]".repeat(42))).toThrow(
      "depth",
    );
    expect(() => inspectJson(JSON.stringify(Array(10001).fill(0)))).toThrow(
      "10,000",
    );
  });
});

it("shows nonfinite parsed numbers explicitly instead of null", () => {
  expect(inspectJson("1e400").nodes[0].value).toBe("Infinity");
  expect(inspectJson("-1e400").nodes[0].value).toBe("-Infinity");
});
