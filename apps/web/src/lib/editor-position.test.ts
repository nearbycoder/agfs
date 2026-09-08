import { expect, it } from "vitest";
import { lineRange, editorPosition } from "./editor-position";
it("locates LF/CRLF lines and the final empty line", () => {
  expect(lineRange("first\r\nsecond\r\n", 2)).toEqual({ start: 7, end: 13 });
  expect(lineRange("a\n", 2)).toEqual({ start: 2, end: 2 });
  expect(lineRange("", 1)).toEqual({ start: 0, end: 0 });
});
it("rejects invalid line numbers", () => {
  for (const n of [0, -1, 1.5, NaN, 3])
    expect(() => lineRange("a\nb", n)).toThrow();
});
it("reports Unicode character columns and selections", () =>
  expect(editorPosition("a\n😀xy", 4, 6)).toEqual({
    line: 2,
    column: 2,
    selected: 2,
  }));
