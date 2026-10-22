export type EditorIndex = {
  readonly text: string;
  readonly lineStarts: readonly number[];
  readonly surrogatePairEnds: readonly number[];
};

/** Build once per document revision; offsets are native textarea UTF-16 offsets. */
export function createEditorIndex(text: string): EditorIndex {
  const lineStarts = [0];
  const surrogatePairEnds: number[] = [];
  for (let offset = 0; offset < text.length; offset++) {
    const code = text.charCodeAt(offset);
    if (code === 10) lineStarts.push(offset + 1);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = text.charCodeAt(offset + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        surrogatePairEnds.push(offset + 2);
        offset++;
      }
    }
  }
  return { text, lineStarts, surrogatePairEnds };
}

/** Number of entries at or before an offset, without scanning the document. */
function upperBound(offsets: readonly number[], offset: number) {
  let low = 0;
  let high = offsets.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (offsets[middle] <= offset) low = middle + 1;
    else high = middle;
  }
  return low;
}

function codePointCount(index: EditorIndex, start: number, end: number) {
  if (end <= start) return 0;
  // Only complete pairs inside the slice count as one code point. A selection
  // can begin or end between surrogate halves, which each count independently.
  const pairs =
    upperBound(index.surrogatePairEnds, end) -
    upperBound(index.surrogatePairEnds, start + 1);
  return end - start - pairs;
}

/** Pass an index for repeated O(1) line lookups; strings remain supported. */
export function lineRange(document: string | EditorIndex, line: number) {
  if (!Number.isInteger(line) || line < 1)
    throw new Error("Enter a whole line number starting at 1.");
  const index =
    typeof document === "string" ? createEditorIndex(document) : document;
  if (line > index.lineStarts.length)
    throw new Error("That line is outside this document.");
  const start = index.lineStarts[line - 1];
  let end =
    line < index.lineStarts.length
      ? index.lineStarts[line] - 1
      : index.text.length;
  if (index.text[end - 1] === "\r") end--;
  return { start, end: Math.max(start, end) };
}

/** Pass an index for O(log n) caret/selection lookups, including Unicode columns. */
export function editorPosition(
  document: string | EditorIndex,
  start: number,
  end: number,
) {
  const index =
    typeof document === "string" ? createEditorIndex(document) : document;
  const clampedStart = Math.max(0, Math.min(start, index.text.length));
  // Match String.slice's integer coercion, including fractional and NaN bounds.
  const cursor = Math.trunc(clampedStart) || 0;
  const selectionEnd =
    Math.trunc(Math.max(clampedStart, Math.min(end, index.text.length))) || 0;
  const line = upperBound(index.lineStarts, cursor);
  return {
    line,
    column: codePointCount(index, index.lineStarts[line - 1], cursor) + 1,
    selected: codePointCount(index, cursor, selectionEnd),
  };
}
