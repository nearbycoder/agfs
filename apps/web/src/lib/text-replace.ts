export function textReplacement(
  text: string,
  find: string,
  replacement: string,
  matchCase = true,
  wholeWord = false,
) {
  if (text.length > 262144 || find.length > 256 || replacement.length > 4096)
    throw new Error(
      "Use text up to 256 KiB, a search up to 256 characters, and a replacement up to 4,096 characters.",
    );
  if (!find)
    return {
      output: text,
      count: 0,
      samples: [] as { before: string; after: string }[],
    };
  const escaped = find.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(
    wholeWord ? `(?<![\\p{L}\\p{N}_])${escaped}(?![\\p{L}\\p{N}_])` : escaped,
    matchCase ? "gu" : "giu",
  );
  let count = 0,
    removed = 0;
  const samples: { before: string; after: string }[] = [];
  for (const match of text.matchAll(pattern)) {
    if (++count > 10000)
      throw new Error(
        "More than 10,000 matches. Narrow the search before replacing.",
      );
    removed += match[0].length;
    if (samples.length < 5) {
      const start = match.index!,
        end = start + match[0].length;
      const left = text.slice(Math.max(0, start - 24), start),
        right = text.slice(end, end + 24);
      samples.push({
        before: left + match[0] + right,
        after: left + replacement + right,
      });
    }
  }
  if (text.length - removed + count * replacement.length > 262144)
    throw new Error("Replacement would exceed the editor’s 256 KiB limit.");
  const output = text.replace(pattern, () => replacement);
  if (new TextEncoder().encode(output).length > 262144)
    throw new Error("Replacement would exceed the editor’s 256 KiB limit.");
  return { output, count, samples };
}
