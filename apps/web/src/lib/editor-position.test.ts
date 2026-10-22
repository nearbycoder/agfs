import { expect, it } from "vitest";
import {
  createEditorIndex,
  lineRange,
  editorPosition,
} from "./editor-position";
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

// The original slice-based definition is an independent semantic oracle for
// UTF-16 boundaries, including selections that cut a surrogate pair in half.
function referencePosition(text: string, start: number, end: number) {
  const cursor = Math.max(0, Math.min(start, text.length));
  const prefix = text.slice(0, cursor);
  return {
    line: prefix.split("\n").length,
    column: Array.from(prefix.slice(prefix.lastIndexOf("\n") + 1)).length + 1,
    selected: Array.from(
      text.slice(cursor, Math.max(cursor, Math.min(end, text.length))),
    ).length,
  };
}

it("preserves every UTF-16 selection boundary across Unicode and newline forms", () => {
  for (const text of [
    "",
    "plain\ntext\n",
    "a\r\nb\r\n\r",
    "😀x𐀀\n🧑🏽‍💻e\u0301\r\n",
    "\ud800a\udc00\ud800\ud800\udc00\udc00\n",
  ]) {
    const index = createEditorIndex(text);
    for (let start = 0; start <= text.length; start++) {
      for (let end = 0; end <= text.length; end++) {
        expect(editorPosition(index, start, end)).toEqual(
          referencePosition(text, start, end),
        );
      }
    }
  }
});

it("counts surrogate halves independently when a selection starts or ends inside a pair", () => {
  const index = createEditorIndex("😀😀");
  expect(editorPosition(index, 1, 3)).toEqual({
    line: 1,
    column: 2,
    selected: 2,
  });
  expect(editorPosition(index, 1, 4)).toEqual({
    line: 1,
    column: 2,
    selected: 2,
  });
  expect(editorPosition(index, 0, 4)).toEqual({
    line: 1,
    column: 1,
    selected: 2,
  });
  expect(editorPosition(index, 2, 4)).toEqual({
    line: 1,
    column: 2,
    selected: 1,
  });
});

it("counts code points rather than graphemes for combining marks and joined emoji", () => {
  const index = createEditorIndex("e\u0301🧑🏽‍💻");
  expect(editorPosition(index, 2, index.text.length)).toEqual({
    line: 1,
    column: 3,
    selected: 4,
  });
});

it("keeps CRLF caret columns and selections distinct from selectable line content", () => {
  const index = createEditorIndex("😀\r\nx\r\n");
  expect(lineRange(index, 1)).toEqual({ start: 0, end: 2 });
  expect(lineRange(index, 2)).toEqual({ start: 4, end: 5 });
  expect(lineRange(index, 3)).toEqual({ start: 7, end: 7 });
  expect(editorPosition(index, 3, 5)).toEqual({
    line: 1,
    column: 3,
    selected: 2,
  });
  expect(editorPosition(index, 4, 7)).toEqual({
    line: 2,
    column: 1,
    selected: 3,
  });
});

it("preserves empty lines, bare CRs and terminal CR line ranges", () => {
  for (const text of ["", "\n\n", "\r\n\r\n", "x\ry\r", "x\n\r"]) {
    const index = createEditorIndex(text);
    let start = 0;
    text.split("\n").forEach((content, offset) => {
      const expected = {
        start,
        end: start + content.replace(/\r$/, "").length,
      };
      expect(lineRange(index, offset + 1)).toEqual(expected);
      expect(lineRange(text, offset + 1)).toEqual(expected);
      start += content.length + 1;
    });
  }
});

it("clamps and coerces caret bounds just like slicing the draft", () => {
  const text = "a😀\r\nx";
  const index = createEditorIndex(text);
  const bounds = [-Infinity, -100, -0.5, 0, 1.9, 2.1, 6, 99, Infinity, NaN];
  for (const start of bounds) {
    for (const end of bounds) {
      const expected = referencePosition(text, start, end);
      expect(editorPosition(index, start, end)).toEqual(expected);
      expect(editorPosition(text, start, end)).toEqual(expected);
    }
  }
});

it("rejects invalid and out-of-document indexed lines with the existing messages", () => {
  const index = createEditorIndex("a\nb");
  for (const line of [0, -1, 1.5, NaN, Infinity, -Infinity]) {
    expect(() => lineRange(index, line)).toThrow(
      "Enter a whole line number starting at 1.",
    );
  }
  for (const line of [3, 100000]) {
    expect(() => lineRange(index, line)).toThrow(
      "That line is outside this document.",
    );
  }
});

it("keeps document revisions independent", () => {
  const before = createEditorIndex("a\n😀");
  const after = createEditorIndex("😀b");
  expect(editorPosition(after, 3, 3)).toEqual({
    line: 1,
    column: 3,
    selected: 0,
  });
  expect(editorPosition(before, 4, 4)).toEqual({
    line: 2,
    column: 2,
    selected: 0,
  });
  expect(lineRange(before, 2)).toEqual({ start: 2, end: 4 });
  expect(() => lineRange(after, 2)).toThrow(
    "That line is outside this document.",
  );
});

it("bounds repeated large-document lookups to logarithmic index reads", () => {
  const lineCount = 50000;
  const original = createEditorIndex("😀x\r\n".repeat(lineCount));
  let reads = 0;
  const countReads = (offsets: readonly number[]) =>
    new Proxy(offsets, {
      get(target, property, receiver) {
        if (typeof property === "string" && /^\d+$/.test(property)) reads++;
        return Reflect.get(target, property, receiver);
      },
    });
  const index = {
    ...original,
    lineStarts: countReads(original.lineStarts),
    surrogatePairEnds: countReads(original.surrogatePairEnds),
  };
  for (const line of [1, 100, 25000, 49999, 50000]) {
    const start = (line - 1) * 5;
    reads = 0;
    expect(lineRange(index, line)).toEqual({ start, end: start + 3 });
    expect(reads).toBeLessThanOrEqual(2);
    reads = 0;
    expect(editorPosition(index, start + 2, original.text.length)).toEqual({
      line,
      column: 2,
      selected: (lineCount - line) * 4 + 3,
    });
    // Five binary searches plus a line-start lookup, independent of cursor
    // distance. A linear scan of either table would exceed this by orders of magnitude.
    expect(reads).toBeLessThanOrEqual(
      5 * Math.ceil(Math.log2(lineCount + 2)) + 1,
    );
  }
  expect(
    editorPosition(index, original.text.length, original.text.length),
  ).toEqual({
    line: lineCount + 1,
    column: 1,
    selected: 0,
  });
});
