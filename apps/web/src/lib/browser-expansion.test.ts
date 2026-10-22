import { afterEach, describe, expect, it, vi } from "vitest";
import { parseExactJson, stringifyExactJson } from "./lossless-json";
import { compareText, type DiffLine } from "./text-diff";
import { inspectJson, visibleJsonNodes } from "./json-inspector";
import { prepareCsvSearch, filterCsvRows } from "./csv-inspector";
import { jsonlRecords, filterJsonl } from "./jsonl-explorer";
import { profileColumn } from "./csv-profile";
import { exportCsv } from "./csv-download";
import { jsonToCsv } from "./json-to-csv";
import { compilePathGlob, testPathScope } from "./agent-data";
import { selectJsonRecords, jsonlToArray } from "./agent-json";
import { textReplacement } from "./text-replace";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("browser expansion algorithms", () => {
  it("#21 constructs one exact JSON tree, with no native parse of document/numbers", () => {
    const source =
      "[" + Array.from({ length: 9999 }, (_, i) => i + "e10").join(",") + "]";
    const parse = vi.spyOn(JSON, "parse");
    expect(stringifyExactJson(parseExactJson(source))).toBe(source);
    expect(parse).not.toHaveBeenCalled();
  });
  it("#21 rejects malformed separators, numbers, escapes, controls, and duplicate decoded keys", () => {
    for (const source of [
      "",
      "01",
      "+1",
      "1.",
      "1e",
      "true false",
      "[,1]",
      "[1,]",
      '{"x":}',
      '{"x" 1}',
      '{"x":1,}',
      '"a\n"',
      '"\\q"',
      '{"a":1,"\\u0061":2}',
      "\ufeffnull",
      "[true false]",
    ])
      expect(() => parseExactJson(source), source).toThrow();
    for (const source of [
      "  \r\n[1,-0,1e999,null,true,false] ",
      '{"__proto__":1,"constructor":2}',
      '"\\ud800"',
      '"a\\\\\\\"b"',
    ])
      expect(() => parseExactJson(source), source).not.toThrow();
  });
  it("#22 keeps baseline traceback ties and exact line numbering", () => {
    function baseline(a: string[], b: string[]) {
      const scores = Array.from({ length: a.length + 1 }, () =>
        Array(b.length + 1).fill(0),
      );
      for (let i = a.length - 1; i >= 0; i--)
        for (let j = b.length - 1; j >= 0; j--)
          scores[i][j] =
            a[i] === b[j]
              ? 1 + scores[i + 1][j + 1]
              : Math.max(scores[i + 1][j], scores[i][j + 1]);
      let i = 0,
        j = 0;
      const result: DiffLine[] = [];
      while (i < a.length || j < b.length) {
        if (i < a.length && j < b.length && a[i] === b[j])
          result.push({ kind: "same", text: b[j], before: ++i, after: ++j });
        else if (
          j < b.length &&
          (i === a.length || scores[i][j + 1] > scores[i + 1][j])
        )
          result.push({ kind: "added", text: b[j], before: null, after: ++j });
        else
          result.push({
            kind: "removed",
            text: a[i],
            before: ++i,
            after: null,
          });
      }
      return result;
    }
    let seed = 9843;
    const random = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0);
    for (let n = 0; n < 1000; n++) {
      const a = Array.from({ length: random() % 30 }, () =>
        String(random() % 5),
      );
      const b = Array.from({ length: random() % 30 }, () =>
        String(random() % 5),
      );
      expect(compareText(a.join("\n"), b.join("\n")).lines).toEqual(
        baseline(a, b),
      );
    }
  });
  it("#22 uses 129,004 matrix bytes instead of 2,004,002 for 1,000 by 1,000 lines", () => {
    let bytes = 0;
    const U8 = Uint8Array,
      U16 = Uint16Array;
    vi.stubGlobal(
      "Uint8Array",
      class extends U8 {
        constructor(n: number) {
          super(n);
          bytes += this.byteLength;
        }
      },
    );
    vi.stubGlobal(
      "Uint16Array",
      class extends U16 {
        constructor(n: number) {
          super(n);
          bytes += this.byteLength;
        }
      },
    );
    const a = Array(1000).fill("a").join("\n"),
      b = Array(1000).fill("b").join("\n");
    expect(compareText(a, b).lines).toHaveLength(2000);
    expect(bytes).toBe(129004);
  });
  it("#23 skips collapsed subtrees in linear order with escaped and root paths", () => {
    const { nodes } = inspectJson(
      JSON.stringify({ "a/b": { "~": [1, 2] }, a: { x: 3 }, z: 4 }),
    );
    for (const paths of [
      [],
      [""],
      ["/a~1b"],
      ["/a~1b/~0", "/a"],
      ["/a~1b", "/a~1b/~0"],
    ]) {
      const set = new Set(paths);
      expect(visibleJsonNodes(nodes, set)).toEqual(
        nodes.filter(
          (n) =>
            !paths.some(
              (p) => n.path !== p && (p === "" || n.path.startsWith(p + "/")),
            ),
        ),
      );
    }
    expect(
      visibleJsonNodes(nodes, new Set([""]), "3").some((n) => n.value === "3"),
    ).toBe(true);
    const large = inspectJson(
      JSON.stringify(Array.from({ length: 3000 }, (_, i) => ({ value: i }))),
    );
    const set = new Set(
      large.nodes.filter((n) => n.container).map((n) => n.path),
    );
    const has = vi.spyOn(set, "has");
    expect(visibleJsonNodes(large.nodes, set)).toHaveLength(1);
    expect(has).toHaveBeenCalledTimes(1);
  });
  it("#24 formats only on demand and retains the cached exact-token result", () => {
    const repeat = vi.spyOn(String.prototype, "repeat");
    const result = inspectJson('{"x":9007199254740993,"x":1e999,"s":"a\\n"}');
    expect(repeat).not.toHaveBeenCalled();
    expect(result.formatted).toContain("9007199254740993");
    expect(result.formatted).toContain("1e999");
    const calls = repeat.mock.calls.length;
    expect(calls).toBeGreaterThan(0);
    void result.formatted;
    expect(repeat).toHaveBeenCalledTimes(calls);
  });
  it("#25 normalizes CSV cells once, preserving column and row identities", () => {
    const source = Array.from({ length: 5000 }, (_, i) => [
      "ALPHA " + i,
      "BETA",
    ]);
    const lower = vi.spyOn(String.prototype, "toLowerCase");
    const rows = prepareCsvSearch(source, 2);
    expect(lower).toHaveBeenCalledTimes(10000);
    lower.mockClear();
    const all = filterCsvRows(rows, "alpha", -1),
      column = filterCsvRows(rows, "BETA", 1),
      missing = filterCsvRows(rows, "missing", 8),
      empty = filterCsvRows(rows, "", 8);
    const calls = lower.mock.calls.length;
    lower.mockRestore();
    expect(all).toHaveLength(5000);
    expect(column[0]).toBe(rows[0]);
    expect(missing).toHaveLength(0);
    expect(empty).toBe(rows);
    expect(calls).toBe(4);
    expect(rows[4999].index).toBe(5001);
  });
  it("#26 keeps original JSONL source without retaining unused parsed trees or renormalizing lines", () => {
    const source =
      Array.from({ length: 3000 }, (_, i) =>
        JSON.stringify({ level: "WARN", nested: { value: i } }),
      ).join("\n") + "\n{bad}";
    const rows = jsonlRecords(source, false);
    expect(rows.every((r) => r.value === null)).toBe(true);
    const lower = vi.spyOn(String.prototype, "toLowerCase");
    const valid = filterJsonl(rows, "VALUE", "warn"),
      invalid = filterJsonl(rows, "bad", null);
    const calls = lower.mock.calls.length;
    lower.mockRestore();
    expect(valid).toHaveLength(3000);
    expect(invalid).toHaveLength(1);
    expect(calls).toBe(2);
    expect(rows[3000].error).toBeTruthy();
  });
  it("#27 returns the same top five with bounded work and stable locale ties", () => {
    const rows = Array.from({ length: 5000 }, (_, i) => [
      String((i * 1973) % 5000).padStart(4, "0"),
    ]);
    const sorted = [...new Map(rows.map(([v]) => [v, 1] as [string, number]))]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 5);
    const compare = vi.spyOn(String.prototype, "localeCompare");
    expect(profileColumn(rows, 0, 1).common).toEqual(sorted);
    expect(compare.mock.calls.length).toBeLessThan(6000);
  });
  it("#28 consumes CSV rows incrementally, stops oversized output, and keeps formula protection", () => {
    let consumed = 0;
    function* rows() {
      while (true) {
        consumed++;
        yield ["x".repeat(262144)];
      }
    }
    expect(() => exportCsv(rows())).toThrow(/1 MiB/);
    expect(consumed).toBe(4);
    expect(
      exportCsv(
        (function* () {
          yield ["=SUM(1)", '"', "😀"];
        })(),
      ),
    ).toBe('\ufeff"\'=SUM(1)","""","😀"\r\n');
    let reads = 0;
    const records = [
      { a: '"'.repeat(600000) },
      {
        get a() {
          reads++;
          return "later";
        },
      },
    ];
    expect(() => jsonToCsv(records)).toThrow(/1 MiB/);
    expect(reads).toBe(0);
    let rowsRead = 0;
    expect(() =>
      exportCsv(
        (function* () {
          for (let i = 0; i < 5010; i++) {
            rowsRead++;
            yield [];
          }
        })(),
      ),
    ).toThrow(/5,001/);
    expect(rowsRead).toBe(5002);
  });
  it("#29 reuses two glob DP rows instead of allocating one per pattern token", () => {
    const U8 = Uint8Array;
    let arrays = 0;
    vi.stubGlobal(
      "Uint8Array",
      class extends U8 {
        constructor(n: number) {
          super(n);
          arrays++;
        }
      },
    );
    const matches = compilePathGlob("/folder/**/file-?.csv");
    expect(matches("/folder/file-a.csv")).toBe(true);
    expect(matches("/folder/deep/nested/file-b.csv")).toBe(true);
    expect(matches("/folder/deep/file-ab.csv")).toBe(false);
    expect(arrays).toBe(6);
    expect(
      testPathScope(
        "/folder/file-a.csv\n/folder/deep/file-b.csv",
        "/folder/**/file-?.csv",
      ).every((r) => r.matches),
    ).toBe(true);
    expect(() => matches("/" + "x".repeat(4096))).toThrow();
  });
  it("#30 compiles a record pointer once and preserves own-property/index checks", () => {
    const source = JSON.stringify(
      Array.from({ length: 2000 }, () => ({ x: { "a/b": [1] } })),
    );
    const split = vi.spyOn(String.prototype, "split");
    expect(selectJsonRecords(source, "/x/a~1b/0", "1", "equals")).toHaveLength(
      2000,
    );
    expect(split.mock.calls.filter((args) => (args[0] as unknown) === "/")).toHaveLength(1);
    expect(
      selectJsonRecords("[{}]", "/constructor", "", "exists"),
    ).toHaveLength(0);
    expect(selectJsonRecords("[[1]]", "/01", "", "exists")).toHaveLength(0);
  });
  it("#31 validates aggregate JSONL limits without parsing the aggregate again", () => {
    const parse = vi.spyOn(JSON, "parse");
    expect(jsonlToArray("1e999\n9007199254740993\nnull")).toBe(
      "[1e999,9007199254740993,null]",
    );
    expect(parse).not.toHaveBeenCalled();
    expect(() => jsonlToArray("[".repeat(40) + "1" + "]".repeat(40))).toThrow(
      /40/,
    );
    expect(() => jsonlToArray(Array(5000).fill("[0]").join("\n"))).toThrow(
      /10,000/,
    );
    expect(() => jsonlToArray('"' + "x".repeat(262140) + '"\n0')).toThrow(
      /256 KiB/,
    );
  });
  it("#32 builds replacements in one regex traversal while keeping literal replacements and limits", () => {
    const source = "a ".repeat(1000);
    const replace = vi.spyOn(String.prototype, "replace");
    const result = textReplacement(source, "a", "$&");
    expect(result.output).toBe("$& ".repeat(1000));
    // The only replace invocation escapes the search expression, never the document.
    expect(replace).toHaveBeenCalledTimes(1);
    expect(result.count).toBe(1000);
    expect(result.samples).toHaveLength(5);
    expect(textReplacement("é élan É", "é", "x", false, true).output).toBe(
      "x élan x",
    );
    expect(() => textReplacement("a".repeat(10001), "a", "")).toThrow(/10,000/);
    expect(() =>
      textReplacement("a".repeat(1000), "a", "b".repeat(4096)),
    ).toThrow(/256 KiB/);
  });
});
