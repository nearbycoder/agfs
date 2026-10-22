export type DiffLine = {
  kind: "same" | "added" | "removed";
  text: string;
  before: number | null;
  after: number | null;
};
export function compareText(
  before: string,
  after: string,
  ignoreWhitespace = false,
) {
  const a = before === "" ? [] : before.split("\n"),
    b = after === "" ? [] : after.split("\n");
  if (a.length > 1500 || b.length > 1500 || a.length * b.length > 1000000)
    throw new Error(
      "Comparison supports up to 1,500 lines per file and one million line pairs.",
    );
  const key = (s: string) =>
    ignoreWhitespace ? s.trim().replace(/\s+/g, " ") : s;
  const ak = a.map(key),
    bk = b.map(key);
  const lines: DiffLine[] = [];
  let prefix = 0;
  while (prefix < a.length && prefix < b.length && ak[prefix] === bk[prefix]) {
    lines.push({
      kind: "same",
      text: b[prefix],
      before: prefix + 1,
      after: prefix + 1,
    });
    prefix++;
  }
  const height = a.length - prefix,
    width = b.length - prefix;
  // Only the right-vs-down decision is needed during traceback. Equality is
  // checked from source keys, so one bit replaces each full 16-bit score.
  const decisions = new Uint8Array(Math.ceil((height * width) / 8));
  let below = new Uint16Array(width + 1),
    row = new Uint16Array(width + 1);
  for (let i = height - 1; i >= 0; i--) {
    row[width] = 0;
    for (let j = width - 1; j >= 0; j--) {
      if (ak[i + prefix] === bk[j + prefix]) row[j] = 1 + below[j + 1];
      else {
        const right = row[j + 1] > below[j];
        row[j] = right ? row[j + 1] : below[j];
        if (right) {
          const bit = i * width + j;
          decisions[bit >>> 3] |= 1 << (bit & 7);
        }
      }
    }
    [row, below] = [below, row];
  }
  let i = prefix,
    j = prefix,
    added = 0,
    removed = 0;
  while (i < a.length || j < b.length) {
    const bit = (i - prefix) * width + j - prefix;
    if (i < a.length && j < b.length && ak[i] === bk[j])
      lines.push({ kind: "same", text: b[j], before: ++i, after: ++j });
    else if (
      j < b.length &&
      (i === a.length || !!(decisions[bit >>> 3] & (1 << (bit & 7))))
    ) {
      lines.push({ kind: "added", text: b[j], before: null, after: ++j });
      added++;
    } else {
      lines.push({ kind: "removed", text: a[i], before: ++i, after: null });
      removed++;
    }
  }
  return { lines, added, removed };
}
