import { readmeBlocks } from "./readme";
export function markdownDocument(text: string) {
  if (new TextEncoder().encode(text).length > 262144)
    throw new Error("Markdown is limited to 256 KiB.");
  const blocks = readmeBlocks(text);
  if (blocks.length > 1500)
    throw new Error("Preview is limited to 1,500 blocks.");
  const headings = blocks.flatMap((block, index) =>
    block.kind === "heading"
      ? [{ index, level: block.level ?? 1, text: block.text }]
      : [],
  );
  const words = blocks
    .filter((b) => b.kind !== "code")
    .map((b) => b.text)
    .join(" ")
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
  return {
    blocks,
    headings,
    words,
    minutes: Math.max(1, Math.ceil(words / 200)),
    codeBlocks: blocks.filter((b) => b.kind === "code").length,
  };
}
