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
    bk = b.map(key),
    width = b.length + 1,
    dp = new Uint16Array((a.length + 1) * width);
  for (let i = a.length - 1; i >= 0; i--)
    for (let j = b.length - 1; j >= 0; j--)
      dp[i * width + j] =
        ak[i] === bk[j]
          ? 1 + dp[(i + 1) * width + j + 1]
          : Math.max(dp[(i + 1) * width + j], dp[i * width + j + 1]);
  let i = 0,
    j = 0;
  const lines: DiffLine[] = [];
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && ak[i] === bk[j]) {
      lines.push({ kind: "same", text: b[j], before: ++i, after: ++j });
    } else if (
      j < b.length &&
      (i === a.length || dp[i * width + j + 1] > dp[(i + 1) * width + j])
    ) {
      lines.push({ kind: "added", text: b[j], before: null, after: ++j });
    } else {
      lines.push({ kind: "removed", text: a[i], before: ++i, after: null });
    }
  }
  return {
    lines,
    added: lines.filter((l) => l.kind === "added").length,
    removed: lines.filter((l) => l.kind === "removed").length,
  };
}
