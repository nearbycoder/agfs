import { describe, expect, it } from "vitest";
import { runRecordTool, previewJsonPatch } from "./browser-record-tools";
import {
  exactKey,
  exactOutput,
  decimal,
  compareDecimal,
  workBudget,
} from "./browser-feature-core";
import { parseExactJson, JsonNumber } from "./lossless-json";

const run = (
  id: string,
  source: string,
  extra = "",
  options: Record<string, string> = {},
) => runRecordTool("record-" + id, source, extra, options);
describe("exact browser record preparation", () => {
  it("#71 projects escaped pointers, exact integers and hostile own keys", () => {
    const result = run(
      "project",
      '[{"a/b":{"~id":9007199254740993},"__proto__":{"constructor":"safe"}}]',
      '{"n":"/a~1b/~0id","__proto__":"/__proto__","constructor":"/__proto__/constructor"}',
      { missing: "error" },
    );
    expect(result.output).toBe(
      '[{"n":9007199254740993,"__proto__":{"constructor":"safe"},"constructor":"safe"}]',
    );
    expect(({} as Record<string, unknown>).safe).toBeUndefined();
  });
  it("#71 implements explicit missing policies and rejects bad mappings", () => {
    expect(() =>
      run("project", "[{}]", '{"id":"/id"}', { missing: "error" }),
    ).toThrow("Record 1");
    expect(
      run("project", "[{}]", '{"id":"/id"}', { missing: "null" }).output,
    ).toBe('[{"id":null}]');
    expect(
      run("project", "[{}]", '{"id":"/id"}', { missing: "omit" }).output,
    ).toBe("[{}]");
    expect(() =>
      run("project", "[]", '{"id":3}', { missing: "error" }),
    ).toThrow("strings");
    expect(() =>
      run("project", "[]", '{"id":"/a~2"}', { missing: "error" }),
    ).toThrow("escapes");
  });
  it("#71 refuses wide projection before allocating an oversized result", () => {
    const source = JSON.stringify(Array(1000).fill(1));
    const mapping = JSON.stringify(
      Object.fromEntries(
        Array.from({ length: 30 }, (_, i) => ["field" + i, ""]),
      ),
    );
    expect(() => run("project", source, mapping, { missing: "error" })).toThrow(
      "Projection would exceed",
    );
  });
  it("#72 deduplicates structural values without changing survivor numeric literals", () => {
    const input = '[{"a":1e2,"b":-0},{"b":0.0,"a":100.0},{"a":101,"b":0}]';
    expect(
      run("dedupe", input, "", { pointer: "", keep: "first" }).output,
    ).toBe('[{"a":1e2,"b":-0},{"a":101,"b":0}]');
    expect(run("dedupe", input, "", { pointer: "", keep: "last" }).output).toBe(
      '[{"b":0.0,"a":100.0},{"a":101,"b":0}]',
    );
  });
  it("#72 separates missing and null; selected survivors stay in original order", () => {
    const input =
      '[{"n":null,"id":"null"},{"id":"missing1"},{"n":null,"id":"null2"},{"id":"missing2"}]';
    expect(
      JSON.parse(
        run("dedupe", input, "", { pointer: "/n", keep: "last" }).output,
      ).map((r: { id: string }) => r.id),
    ).toEqual(["null2", "missing2"]);
  });
  it("#73 groups equivalent exact decimals and negative zero, preserving original keys", () => {
    const grouped = run(
      "group",
      '[{"n":1e2},{"n":100.00},{"n":-0},{"n":0},{"n":"100"},{"n":null}]',
      "",
      { pointer: "/n" },
    );
    expect(grouped.output).toBe(
      '[{"key":1e2,"records":[{"n":1e2},{"n":100.00}]},{"key":-0,"records":[{"n":-0},{"n":0}]},{"key":"100","records":[{"n":"100"}]},{"key":null,"records":[{"n":null}]}]',
    );
    expect(() => run("group", "[{}]", "", { pointer: "/missing" })).toThrow(
      "missing",
    );
    expect(() => run("group", '[{"n":{}}]', "", { pointer: "/n" })).toThrow(
      "scalar",
    );
  });
  it("#74 sorts enormous exponents, large integers, stable equal values and mixed scalar types", () => {
    expect(
      run(
        "sort",
        "[1e999999,9007199254740993,9007199254740992,-1e999999,-0,0.0,1e-999999]",
        "",
        { pointer: "", direction: "asc" },
      ).output,
    ).toBe(
      "[-1e999999,-0,0.0,1e-999999,9007199254740992,9007199254740993,1e999999]",
    );
    expect(
      run("sort", '["z",true,null,"a",false,2]', "", {
        pointer: "",
        direction: "desc",
      }).output,
    ).toBe('["z","a",2,true,false,null]');
    expect(() =>
      run("sort", "[{}]", "", { pointer: "/n", direction: "asc" }),
    ).toThrow("missing");
  });
  it("#75 indexes own __proto__/constructor keys and rejects duplicates/non-string/missing", () => {
    const result = JSON.parse(
      run(
        "index",
        '[{"id":"__proto__","v":1},{"id":"constructor","v":2}]',
        "",
        { pointer: "/id" },
      ).output,
    );
    expect(Object.hasOwn(result, "__proto__")).toBe(true);
    expect(result.constructor.v).toBe(2);
    expect(() =>
      run("index", '[{"id":"a"},{"id":"a"}]', "", { pointer: "/id" }),
    ).toThrow("duplicate");
    expect(() => run("index", '[{"id":1}]', "", { pointer: "/id" })).toThrow(
      "strings",
    );
    expect(() => run("index", "[{}]", "", { pointer: "/constructor" })).toThrow(
      "missing",
    );
  });
  it("#76 applies sequential operations, copy isolation and exact tests", () => {
    const source = '{"a":[1,2],"n":9007199254740993,"__proto__":{}}';
    const patch =
      '[{"op":"test","path":"/n","value":9007199254740993.0},{"op":"copy","from":"/a","path":"/b"},{"op":"replace","path":"/b/0","value":3},{"op":"move","from":"/a/0","path":"/a/1"},{"op":"add","path":"/a/-","value":4},{"op":"remove","path":"/n"},{"op":"add","path":"/__proto__/constructor","value":"safe"}]';
    expect(previewJsonPatch(source, patch).output).toBe(
      '{"a":[2,1,4],"__proto__":{"constructor":"safe"},"b":[3,2]}',
    );
    expect(source).toBe('{"a":[1,2],"n":9007199254740993,"__proto__":{}}');
  });
  it("#76 tests structural equality and refuses failed tests atomically", () => {
    expect(
      previewJsonPatch(
        '{"a":-0,"b":1e2}',
        '[{"op":"test","path":"","value":{"b":100.0,"a":0}}]',
      ).output,
    ).toBe('{"a":-0,"b":1e2}');
    expect(() =>
      previewJsonPatch(
        '{"a":1}',
        '[{"op":"replace","path":"/a","value":2},{"op":"test","path":"/a","value":1}]',
      ),
    ).toThrow("Operation 2: Test failed");
    expect(() =>
      previewJsonPatch(
        '{"a":9007199254740993}',
        '[{"op":"test","path":"/a","value":9007199254740992}]',
      ),
    ).toThrow("Test failed");
  });
  it.each([
    ['[{"op":"remove","path":""}]', "Removing the root"],
    ['[{"op":"move","from":"","path":"/child"}]', "descendants"],
    ['[{"op":"add","path":"/missing/child","value":1}]', "Parent"],
    ['[{"op":"replace","path":"/missing","value":1}]', "does not exist"],
    ['[{"op":"copy","from":"/constructor","path":"/x"}]', "missing"],
    ['[{"op":"replace","path":"/a"}]', "requires a value"],
    ['[{"op":"oops","path":"/a"}]', "valid patch"],
  ])("#76 rejects invalid patch %s", (patch, error) =>
    expect(() => previewJsonPatch('{"a":1}', patch)).toThrow(error),
  );
  it("#76 implements escaped paths and array limits", () => {
    expect(
      previewJsonPatch(
        '{"a/b":{"~":1}}',
        '[{"op":"replace","path":"/a~1b/~0","value":2}]',
      ).output,
    ).toBe('{"a/b":{"~":2}}');
    for (const path of ["/01", "/2", "/-1", "/9999999999999999999999"])
      expect(() =>
        previewJsonPatch(
          "[1]",
          JSON.stringify([{ op: "replace", path, value: 2 }]),
        ),
      ).toThrow();
    expect(
      previewJsonPatch("[1]", '[{"op":"add","path":"/1","value":2}]').output,
    ).toBe("[1,2]");
    expect(
      previewJsonPatch("[1]", '[{"op":"move","from":"/0","path":"/0"}]').output,
    ).toBe("[1]");
  });
  it("#76 stops copy growth and cumulative patch work", () => {
    const growth = Array.from({ length: 20 }, (_, i) => ({
      op: "copy",
      from: "",
      path: "/copy" + i,
    }));
    expect(() => previewJsonPatch('{"a":1}', JSON.stringify(growth))).toThrow(
      /Output|work limit/,
    );
    const many = "[" + Array(9000).fill("0").join(",") + "]";
    expect(() =>
      previewJsonPatch(
        many,
        JSON.stringify(
          Array.from({ length: 100 }, () => ({
            op: "test",
            path: "",
            value: [],
          })),
        ),
      ),
    ).toThrow();
    expect(() =>
      previewJsonPatch(
        many,
        JSON.stringify(
          Array.from({ length: 100 }, () => ({
            op: "test",
            path: "/0",
            value: 0,
          })),
        ),
      ),
    ).toThrow("work limit");
  });
  it("#77 distinguishes missing, optional, null and type mismatch", () => {
    const result = run(
      "audit",
      '[{"a":null},{},{"a":"s"}]',
      '[{"pointer":"/a","type":"string","required":true},{"pointer":"/optional","type":"number","required":false}]',
    );
    expect(result.rows).toEqual([
      ["1", "/a", "string", "null"],
      ["2", "/a", "string", "missing"],
    ]);
    expect(JSON.parse(result.output).totalFindings).toBe(2);
    expect(() =>
      run("audit", "[]", '[{"pointer":"/a","type":"integer"}]'),
    ).toThrow("JSON type");
  });
  it("#77 reports all counts while retaining at most 1,000 findings", () => {
    const result = run(
      "audit",
      JSON.stringify(Array.from({ length: 1500 }, () => ({}))),
      '[{"pointer":"/id","type":"string"}]',
    );
    expect(result.rows).toHaveLength(1000);
    expect(JSON.parse(result.output)).toMatchObject({
      totalFindings: 1500,
      reportedFindings: 1000,
      complete: false,
    });
  });
  it("enforces duplicate-key, byte, depth, output and work ceilings", () => {
    expect(() =>
      run("dedupe", '[{"a":1,"a":2}]', "", { pointer: "", keep: "first" }),
    ).toThrow("Duplicate JSON key");
    expect(() => run("dedupe", '"' + "é".repeat(140000) + '"')).toThrow(
      "256 KiB",
    );
    expect(() =>
      exactOutput(Array.from({ length: 10001 }, () => null)),
    ).toThrow("10,000");
    expect(() => exactOutput("x".repeat(262145))).toThrow("256 KiB");
    expect(() => exactKey(parseExactJson("[1,2]"), workBudget(2))).toThrow(
      "work limit",
    );
    expect(exactKey(parseExactJson('{"__proto__":1,"constructor":-0}'))).toBe(
      '{"__proto__":1e0,"constructor":0}',
    );
  });
  it("compares generated exact decimal pairs against scaled integer arithmetic", () => {
    for (let i = 1; i <= 1000; i++) {
      const a = BigInt(i * 98765431) - 50000000000n,
        b = BigInt(i * 11777771) - 20000000000n;
      const x = decimal(`${a}e-3`),
        y = decimal(`${b}e-2`);
      expect(Math.sign(compareDecimal(x, y))).toBe(
        a === b * 10n ? 0 : a < b * 10n ? -1 : 1,
      );
    }
    expect(compareDecimal(decimal("-0e999999"), decimal("0.000"))).toBe(0);
    expect(exactOutput(new JsonNumber("9007199254740993"))).toBe(
      "9007199254740993",
    );
  });
});
