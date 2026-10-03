import { describe, expect, it } from "vitest";
import {
  arrayToJsonl,
  jsonlToArray,
  jsonShape,
  mergePatch,
  redactJson,
  selectJsonRecords,
} from "./agent-json";
import { parseExactJson, stringifyExactJson } from "./lossless-json";
describe("agent JSON workflows", () => {
  it("applies object merge/delete and array replacement without rounding", () => {
    const target = parseExactJson(
      '{"nested":{"keep":9007199254740993,"delete":1},"array":[1,2]}',
    );
    const output = stringifyExactJson(
      mergePatch(
        target,
        parseExactJson('{"nested":{"delete":null,"add":1e400},"array":[3]}'),
      ),
    );
    expect(output).toBe(
      '{"nested":{"keep":9007199254740993,"add":1e400},"array":[3]}',
    );
    expect(stringifyExactJson(target)).toContain('"delete":1');
  });
  it("handles scalar patches and prototype-looking keys as data", () => {
    expect(
      stringifyExactJson(
        mergePatch(parseExactJson('{"a":1}'), parseExactJson("null")),
      ),
    ).toBe("null");
    const value = mergePatch(
      null,
      parseExactJson('{"__proto__":{"polluted":true}}'),
    );
    expect(Object.getPrototypeOf(value)).toBeNull();
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
  it("redacts escaped keys, arrays and selected parents while preserving numbers", () => {
    expect(
      redactJson(
        '{"a/b":{"~key":"secret","n":9007199254740993},"users":[{"email":"private"}]}',
        ["/a~1b/~0key", "/users/0/email"],
      ),
    ).toBe(
      '{"a/b":{"~key":"[REDACTED]","n":9007199254740993},"users":[{"email":"[REDACTED]"}]}',
    );
    expect(redactJson('{"a":{"b":1}}', ["/a", "/a/b"])).toBe(
      '{"a":"[REDACTED]"}',
    );
    expect(redactJson('{"a":1}', [""])).toBe('"[REDACTED]"');
  });
  it("rejects missing and malformed redaction paths", () => {
    expect(() => redactJson('{"a":null}', ["/b"])).toThrow("Missing");
    expect(() => redactJson('{"a":null}', ["/a~2"])).toThrow("escapes");
    expect(() => redactJson("[1]", ["/01"])).toThrow("Missing");
    expect(() => redactJson("{}", [])).toThrow("1–100");
  });
  it("profiles heterogeneous array field types without coercion", () => {
    const profile = jsonShape('[{"x":1},{"x":null},{"x":"1"}]');
    expect(profile.find((p) => p.path === "/*/x")).toEqual({
      path: "/*/x",
      types: ["null", "number", "string"],
      occurrences: 3,
    });
  });
  it("filters exact values and distinguishes null from missing", () => {
    const source =
      '[{"id":9007199254740993,"x":null},{"id":9007199254740992},{"id":"9007199254740993"}]';
    expect(
      stringifyExactJson(
        selectJsonRecords(source, "/id", "9007199254740993", "equals"),
      ),
    ).toBe('[{"id":9007199254740993,"x":null}]');
    expect(selectJsonRecords(source, "/x", "", "exists")).toHaveLength(1);
    expect(selectJsonRecords(source, "/x", "", "missing")).toHaveLength(2);
    expect(selectJsonRecords(source, "/id", "993", "contains")).toHaveLength(2);
  });
  it("roundtrips JSONL including unsafe integers, exponents and null", () => {
    const source = '[9007199254740993,1e400,null,{"text":"a\\nb"}]';
    expect(jsonlToArray(arrayToJsonl(source))).toBe(source);
    expect(arrayToJsonl("[]")).toBe("");
    expect(jsonlToArray(" \nnull\n\n")).toBe("[null]");
  });
  it("reports exact bad JSONL lines and rejects duplicate keys", () => {
    expect(() => jsonlToArray("1\n\n{bad}\n")).toThrow("Line 3");
    expect(() => arrayToJsonl('[{"x":1,"x":2}]')).toThrow("Duplicate");
  });
});
