export const AGENT_TEXT_LIMIT = 262144;
export function boundedAgentText(text: string) {
  if (new TextEncoder().encode(text).length > AGENT_TEXT_LIMIT)
    throw new Error("Input and generated output are limited to 256 KiB.");
  return text;
}
export function promptVariables(template: string, source: string) {
  const value: unknown = JSON.parse(source);
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Variables must be a JSON object of strings.");
  const vars = value as Record<string, unknown>,
    missing = new Set<string>();
  const output = template.replace(
    /\{\{\s*([a-zA-Z_][\w.-]*)\s*\}\}/g,
    (_, key: string) => {
      if (!Object.hasOwn(vars, key)) {
        missing.add(key);
        return "";
      }
      if (typeof vars[key] !== "string")
        throw new Error("Variable " + key + " must be a string.");
      return vars[key];
    },
  );
  if (missing.size)
    throw new Error("Missing variables: " + [...missing].join(", "));
  return boundedAgentText(output);
}
export function chunkContext(
  source: string,
  maxCharacters: number,
  overlapLines: number,
) {
  boundedAgentText(source);
  if (
    !Number.isInteger(maxCharacters) ||
    maxCharacters < 100 ||
    maxCharacters > 50000 ||
    !Number.isInteger(overlapLines) ||
    overlapLines < 0 ||
    overlapLines > 20
  )
    throw new Error(
      "Use a chunk size of 100–50,000 characters and overlap of 0–20 lines.",
    );
  if (!source) return [];
  const lines = source.split(/\r\n|\n|\r/);
  if (lines.some((line) => line.length + 1 > maxCharacters))
    throw new Error(
      "A line exceeds the chunk size. Increase the size to preserve whole lines.",
    );
  const chunks: {
    index: number;
    startLine: number;
    endLine: number;
    text: string;
  }[] = [];
  let start = 0;
  while (start < lines.length) {
    let end = start,
      size = 0;
    while (end < lines.length && size + lines[end].length + 1 <= maxCharacters)
      size += lines[end++].length + 1;
    if (chunks.length >= 500)
      throw new Error(
        "More than 500 chunks. Increase the chunk size or reduce overlap.",
      );
    chunks.push({
      index: chunks.length + 1,
      startLine: start + 1,
      endLine: end,
      text: lines.slice(start, end).join("\n"),
    });
    if (end === lines.length) break;
    start = Math.max(start + 1, end - overlapLines);
  }
  return chunks;
}
export type ContextFile = { path: string; text: string; etag?: string | null };
export function contextPack(
  files: ContextFile[],
  budget: number,
  instructions: string,
) {
  if (
    !files.length ||
    files.length > 20 ||
    new Set(files.map((f) => f.path)).size !== files.length
  )
    throw new Error("Choose 1–20 distinct files.");
  if (!Number.isInteger(budget) || budget < 100 || budget > 100000)
    throw new Error("Use an estimated token budget of 100–100,000.");
  const output = boundedAgentText(
    JSON.stringify({ version: 1, instructions, files }, null, 2),
  );
  // Conservative heuristic, explicitly not a model tokenizer.
  const estimatedTokens = Math.ceil(
    new TextEncoder().encode(output).length / 3,
  );
  if (estimatedTokens > budget)
    throw new Error(
      `Pack needs about ${estimatedTokens.toLocaleString()} tokens (UTF-8 bytes ÷ 3). Narrow the files or increase the budget. No content was truncated.`,
    );
  return { output, estimatedTokens };
}
