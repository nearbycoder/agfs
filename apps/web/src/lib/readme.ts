export function chooseReadme(
  entries: { name: string; path: string; kind: string }[],
) {
  for (const name of ["readme.md", "readme.markdown", "readme.txt", "readme"]) {
    const entry = entries.find(
      (e) => e.kind === "file" && e.name.toLowerCase() === name,
    );
    if (entry) return entry;
  }
  return null;
}
export type ReadmeBlock = {
  kind: "heading" | "paragraph" | "list" | "code";
  text: string;
  level?: number;
};
export function readmeBlocks(text: string): ReadmeBlock[] {
  const lines = text.split("\n");
  if (lines.length > 5000)
    throw new Error(
      "README preview supports up to 5,000 lines. Download the file to read more.",
    );
  const blocks: ReadmeBlock[] = [];
  let code: string[] | null = null;
  for (const line of lines) {
    if (/^\s*```/.test(line)) {
      if (code) {
        blocks.push({ kind: "code", text: code.join("\n") });
        code = null;
      } else code = [];
      continue;
    }
    if (code) {
      code.push(line);
      continue;
    }
    const heading = /^(#{1,6})\s+(.+)$/.exec(line),
      list = /^\s*[-*+]\s+(.+)$/.exec(line);
    if (heading)
      blocks.push({
        kind: "heading",
        level: heading[1].length,
        text: heading[2],
      });
    else if (list) blocks.push({ kind: "list", text: list[1] });
    else if (line.trim()) blocks.push({ kind: "paragraph", text: line });
  }
  if (code) blocks.push({ kind: "code", text: code.join("\n") });
  return blocks;
}
