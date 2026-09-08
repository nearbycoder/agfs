import { describe, it, expect } from "vitest";
import { parseExactJson } from "./lossless-json";
import { compareJson } from "./json-compare";
const diff = (a: string, b: string) =>
  compareJson(parseExactJson(a), parseExactJson(b));
describe("Structural JSON comparison", () => {
  it("ignores object order and tracks nested changes with escaped paths", () => {
    expect(diff('{"x":1,"y":2}', '{"y":2,"x":1}')).toEqual([]);
    expect(
      diff('{"a/b":[1,2],"gone":true}', '{"a/b":[1,3],"new":null}').map((c) => [
        c.path,
        c.kind,
      ]),
    ).toEqual([
      ["/a~1b/1", "changed"],
      ["/gone", "removed"],
      ["/new", "added"],
    ]);
  });
  it("distinguishes types and exact numeric spelling", () => {
    expect(diff("1", '"1"')[0].path).toBe("");
    expect(diff("1", "1.0")).toHaveLength(1);
    expect(diff("9007199254740992", "9007199254740993")).toHaveLength(1);
  });
  it("bounds large change sets", () => {
    expect(() =>
      diff(
        JSON.stringify(Array(2001).fill(0)),
        JSON.stringify(Array(2001).fill(1)),
      ),
    ).toThrow();
  });
});
