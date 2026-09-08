export function lineRange(text: string, line: number) {
  if (!Number.isInteger(line) || line < 1)
    throw new Error("Enter a whole line number starting at 1.");
  let start = 0;
  for (let current = 1; current < line; current++) {
    const next = text.indexOf("\n", start);
    if (next < 0) throw new Error("That line is outside this document.");
    start = next + 1;
  }
  const newline = text.indexOf("\n", start);
  let end = newline < 0 ? text.length : newline;
  if (text[end - 1] === "\r") end--;
  return { start, end: Math.max(start, end) };
}
export function editorPosition(text: string, start: number, end: number) {
  const cursor = Math.max(0, Math.min(start, text.length));
  const prefix = text.slice(0, cursor);
  const lineStart = prefix.lastIndexOf("\n") + 1;
  return {
    line: prefix.split("\n").length,
    column: Array.from(prefix.slice(lineStart)).length + 1,
    selected: Array.from(
      text.slice(cursor, Math.max(cursor, Math.min(end, text.length))),
    ).length,
  };
}
