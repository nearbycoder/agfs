export type CleanupOptions = {
  trimTrailing: boolean;
  tabs: "keep" | "2" | "4";
  blankLines: "keep" | "collapse" | "remove";
  lineEndings: "preserve" | "lf" | "crlf";
  finalNewline: "preserve" | "ensure" | "remove";
};
export function cleanText(text: string, options: CleanupOptions) {
  if (new TextEncoder().encode(text).length > 262144)
    throw new Error("Text exceeds 256 KiB.");
  let output = text;
  if (options.trimTrailing) output = output.replace(/[\t ]+(?=\r?$)/gm, "");
  if (options.tabs !== "keep")
    output = output.replace(/\t/g, " ".repeat(Number(options.tabs)));
  if (options.blankLines !== "keep") {
    const lines =
      output.match(/[^\r\n]*(?:\r\n|\n|\r|$)/g)?.filter(Boolean) ?? [];
    let blank = false;
    output = lines
      .filter((line) => {
        const empty = !line.replace(/[\r\n]+$/, "").trim();
        const keep = !empty || (options.blankLines === "collapse" && !blank);
        blank = empty;
        return keep;
      })
      .join("");
  }
  const ending =
    options.lineEndings === "crlf"
      ? "\r\n"
      : options.lineEndings === "lf"
        ? "\n"
        : (text.match(/\r\n|\n|\r/)?.[0] ?? "\n");
  if (options.lineEndings !== "preserve")
    output = output.replace(/\r\n|\r|\n/g, ending);
  if (options.finalNewline !== "preserve") {
    output = output.replace(/[\r\n]+$/, "");
    if (options.finalNewline === "ensure") output += ending;
  }
  if (new TextEncoder().encode(output).length > 262144)
    throw new Error("Cleanup would exceed the editor’s 256 KiB limit.");
  return output;
}
